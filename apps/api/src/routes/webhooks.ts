// language: TS, file: apps/api/src/routes/webhooks.ts, target: Fastify 5
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { initAdapters } from "../services/payments/index.js";
import { getAdapter, listAdapters } from "../services/payments/types.js";
import { applyPaymentEvent } from "../services/payments/webhook-events.js";
import { transitionOrder } from "../services/orders.js";
import { canTransition, type OrderStatus } from "@airsoft/shared";

// Aplicação de eventos vive em services/payments/webhook-events.ts — única
// fonte que transforma resultado financeiro em estado (AUD-15). A rota só
// valida assinatura, persiste o evento bruto e delega.

async function upsertChargeback(
  db: Db,
  input: {
    orderId: string | null;
    paymentId: string | null;
    provider: string;
    providerDisputeId: string;
    amountCents: number;
    reason?: string | null;
    respondBy?: Date | null;
    status?: "notificado" | "ganho" | "perdido" | "encerrado";
  },
) {
  const existing = await db
    .select()
    .from(schema.chargebacks)
    .where(
      and(
        eq(schema.chargebacks.provider, input.provider),
        eq(schema.chargebacks.providerDisputeId, input.providerDisputeId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const patch: Record<string, unknown> = {
      reason: input.reason ?? existing[0].reason,
      respondBy: input.respondBy ?? existing[0].respondBy,
    };
    if (input.status) {
      patch.status = input.status;
      if (input.status === "ganho" || input.status === "perdido" || input.status === "encerrado") {
        patch.resolvedAt = new Date();
      }
    }
    await db.update(schema.chargebacks).set(patch).where(eq(schema.chargebacks.id, existing[0].id));
    return existing[0].id;
  }

  if (!input.orderId || !input.paymentId) return null;
  const inserted = await db
    .insert(schema.chargebacks)
    .values({
      orderId: input.orderId,
      paymentId: input.paymentId,
      provider: input.provider,
      providerDisputeId: input.providerDisputeId,
      status: input.status ?? "notificado",
      amountCents: input.amountCents,
      reason: input.reason ?? null,
      respondBy: input.respondBy ?? null,
      notifiedAt: new Date(),
    })
    .returning();
  return (inserted[0] as { id?: string } | undefined)?.id ?? null;
}

export async function registerWebhookRoutes(app: FastifyInstance, db: Db) {
  app.post("/api/webhooks/:provider", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    await initAdapters(db);
    const adapter = getAdapter(provider);
    if (!adapter) {
      reply.status(404);
      return reply.send({ error: { code: "unknown_provider", message: "Provedor desconhecido" } });
    }

    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(request.body ?? {});
    const sigHeader = adapter.signatureHeader;
    const signature = (request.headers[sigHeader.toLowerCase()] as string | undefined) ?? undefined;
    const signatureValid = adapter.verifyWebhookSignature(rawBody, signature);

    // Em produção, recuse assinatura inválida. Sandbox aceita sem segredo configurado? Adapter decide.
    if (!signatureValid) {
      request.log.warn({ provider }, "webhook signature invalid");
      reply.status(401);
      return reply.send({ error: { code: "invalid_signature", message: "Assinatura inválida" } });
    }

    let event;
    try {
      event = adapter.parseWebhook(rawBody);
    } catch (e) {
      request.log.warn({ err: e, provider }, "webhook parse failed");
      reply.status(400);
      return reply.send({ error: { code: "invalid_payload", message: "Payload inválido" } });
    }

    // Idempotência: payment_events tem unique(provider,eventId). Inserção duplicada = já processado.
    try {
      await db.insert(schema.paymentEvents).values({
        provider,
        eventId: event.eventId,
        type: event.type,
        payload: event.raw as never,
        signatureValid: true,
        processedAt: null,
      });
    } catch (e) {
      // drizzle embrulha: "Failed query: ..." com a causa original em .cause
      const chain: string[] = [];
      let cur: unknown = e;
      while (cur instanceof Error) {
        chain.push(cur.message);
        cur = (cur as { cause?: unknown }).cause;
      }
      if (chain.some((m) => /unique|duplicate/i.test(m))) {
        return reply.send({ ok: true, duplicate: true });
      }
      throw e;
    }

    // Localiza pagamento pelo providerTransactionId
    let payment: typeof schema.payments.$inferSelect | undefined;
    if (event.providerTransactionId) {
      const rows = await db
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.provider, provider),
            eq(schema.payments.providerTransactionId, event.providerTransactionId),
          ),
        )
        .limit(1);
      payment = rows[0];
    }

    if (payment) {
      await db
        .update(schema.paymentEvents)
        .set({ paymentId: payment.id, processedAt: new Date() })
        .where(and(eq(schema.paymentEvents.provider, provider), eq(schema.paymentEvents.eventId, event.eventId)));
    }

    if (event.type === "chargeback.received" || event.type === "chargeback.resolved") {
      const cbStatus = event.type === "chargeback.resolved" ? "encerrado" : "notificado";
      await upsertChargeback(db, {
        orderId: payment?.orderId ?? null,
        paymentId: payment?.id ?? null,
        provider,
        providerDisputeId: event.disputeId ?? event.eventId,
        amountCents: event.amountCents ?? payment?.amountCents ?? 0,
        reason: event.disputeReason ?? null,
        respondBy: event.respondBy ?? null,
        status: cbStatus,
      });
      if (payment) {
        await db.update(schema.payments).set({ status: "chargeback" }).where(eq(schema.payments.id, payment.id));
        try {
          const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, payment.orderId)).limit(1);
          const order = orderRows[0];
          if (order && canTransition(order.status as OrderStatus, "em_disputa")) {
            await transitionOrder(db, {
              orderId: payment.orderId,
              to: "em_disputa",
              reason: `Chargeback ${event.disputeId ?? event.eventId}`,
              actorLabel: `webhook:${provider}`,
            });
          }
        } catch (err) {
          request.log.warn({ err }, "chargeback order transition skipped");
        }
      }
      return reply.send({ ok: true, processed: "chargeback" });
    }

    if (!payment) {
      // Evento sem pagamento localizado — FICA EM payment_events sem
      // processedAt: se for corrida checkout×webhook (cobrança criada, INSERT
      // local ainda não commitou), o checkout recupera e aplica o evento ao
      // inserir o pagamento (applyPendingEventsForPayment). Registra e
      // confirma recebimento (não falha o webhook).
      request.log.info({ provider, eventId: event.eventId }, "webhook event without local payment — parked");
      return reply.send({ ok: true, processed: false, reason: "payment_not_found" });
    }

    // Estado do pagamento e do pedido derivados do resultado financeiro —
    // mesmo caminho da reconciliação e da recuperação de corrida (AUD-15).
    const outcome = await applyPaymentEvent(db, {
      provider,
      event,
      payment,
      actorLabel: `webhook:${provider}`,
    });

    return reply.send({
      ok: true,
      processed: outcome.applied,
      eventId: event.eventId,
      type: event.type,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.latePayment ? { latePayment: true, decision: "refund_required" } : {}),
    });
  });

  // Health/probe for webhook endpoint
  app.get("/api/webhooks", async (_req, reply) => {
    await initAdapters(db);
    return reply.send({ ok: true, providers: listAdapters().map((a) => a.provider) });
  });
}
