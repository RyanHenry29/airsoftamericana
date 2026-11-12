// language: TS, file: apps/api/src/services/payments/webhook-events.ts, target: Fastify 5 + drizzle
/**
 * Aplicação de eventos de pagamento ao estado local (AUD-15).
 *
 * Único ponto que transforma o RESULTADO FINANCEIRO do provedor em estado
 * do pedido — usado pelo webhook e pela recuperação de corrida do checkout
 * (evento chegou antes do INSERT do pagamento local).
 *
 * Regras:
 *  - Idempotência por evento: chamada repetida é no-op.
 *  - O pagamento NUNCA regride: `aprovado`/`estornado` não são sobrescritos
 *    por recusado/expirado (recusa após aprovação é inconsistência do
 *    provedor — registrada, não aplicada).
 *  - PIX/boleto confirmados só aprovam o pedido via evento; a criação da
 *    cobrança não aprova nada.
 *  - Pagamento aprovado sobre pedido CANCELADO = pagamento tardio: estado
 *    do pedido preservado, alerta de estorno gerado, dinheiro NUNCA
 *    movimentado automaticamente.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import type { NormalizedWebhookEvent } from "./types.js";
import { transitionOrder } from "../orders.js";
import { audit } from "../../lib/audit.js";
import { PAYMENT_PENDING_STATUSES, type OrderStatus } from "@airsoft/shared";

export interface ApplyEventResult {
  applied: boolean;
  reason?: string;
  paymentStatus?: string;
  orderTransitioned?: { from: OrderStatus; to: OrderStatus };
  latePayment?: boolean;
}

/** Reconciliação do pagamento e transição do pedido. Idempotente. */
export async function applyPaymentEvent(
  db: Db,
  input: {
    provider: string;
    event: NormalizedWebhookEvent;
    payment: typeof schema.payments.$inferSelect;
    actorLabel?: string;
  },
): Promise<ApplyEventResult> {
  const { event, payment } = input;

  // Chargebacks são tratados pela rota (tabela própria).
  if (event.type === "chargeback.received" || event.type === "chargeback.resolved") {
    return { applied: false, reason: "chargeback_handled_elsewhere" };
  }

  const targetPaymentStatus: "aprovado" | "recusado" | "expirado" | "estornado" =
    event.type === "payment.approved"
      ? "aprovado"
      : event.type === "payment.recused"
        ? "recusado"
        : event.type === "payment.expired"
          ? "expirado"
          : "estornado";

  // Proteção de regressão: estados financeiros definitivos não regridem.
  const paymentWasApproved = payment.status === "aprovado";
  const paymentWasRefunded = payment.status === "estornado";
  if (
    (paymentWasApproved || paymentWasRefunded) &&
    (targetPaymentStatus === "recusado" || targetPaymentStatus === "expirado")
  ) {
    await audit(db, {
      action: "payment.regression_ignored",
      entity: "payment",
      entityId: payment.id,
      actorLabel: input.actorLabel ?? `webhook:${input.provider}`,
      after: {
        providerEvent: event.eventId,
        current: payment.status,
        attempted: targetPaymentStatus,
      },
    });
    return { applied: false, reason: "payment_regression_ignored", paymentStatus: payment.status };
  }

  // Idempotência financeira: já aplicado, não reaplica.
  if (payment.status === targetPaymentStatus && event.type !== "payment.refunded") {
    return { applied: false, reason: "already_applied", paymentStatus: payment.status };
  }

  const patch: Record<string, unknown> = { status: targetPaymentStatus };
  if (targetPaymentStatus === "aprovado") patch.capturedAt = new Date();
  await db.update(schema.payments).set(patch).where(eq(schema.payments.id, payment.id));

  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, payment.orderId)).limit(1);
  if (!order) {
    return { applied: true, reason: "order_not_found", paymentStatus: targetPaymentStatus };
  }
  const from = order.status as OrderStatus;

  // Pagamento tardio: pedido já cancelado e o dinheiro entrou. O estado do
  // pedido NÃO reabre (cancelado é terminal — histórico append-only). O
  // estorno é decisão humana, jamais automática.
  if (from === "cancelado" && targetPaymentStatus === "aprovado") {
    await audit(db, {
      action: "order.late_payment",
      entity: "order",
      entityId: order.id,
      actorLabel: input.actorLabel ?? `webhook:${input.provider}`,
      after: {
        paymentId: payment.id,
        providerTransactionId: payment.providerTransactionId,
        amountCents: payment.amountCents,
        decision: "refund_required",
      },
    });
    return { applied: true, paymentStatus: "aprovado", latePayment: true };
  }

  // Pedido em revisão/antifraude: o pagamento fica aprovado (realidade
  // financeira), a aprovação do pedido continua sendo decisão humana.
  if (
    targetPaymentStatus === "aprovado" &&
    (from === "em_analise_antifraude" || from === "aguardando_revisao_manual")
  ) {
    return { applied: true, paymentStatus: "aprovado", reason: "awaiting_human_review" };
  }

  // Resultado financeiro decide:
  //   aprovado + pedido aguardando/processamento → pagamento_aprovado
  //   recusado/expirado + pedido aguardando/processamento → cancelado (libera estoque)
  //   estornado + pedido pagável → reembolsado
  const targetOrderStatus: OrderStatus | null =
    targetPaymentStatus === "aprovado"
      ? from === "aguardando_pagamento" || from === "pagamento_em_processamento"
        ? "pagamento_aprovado"
        : null
      : targetPaymentStatus === "estornado"
        ? "reembolsado"
        : "cancelado";

  if (targetOrderStatus && from !== targetOrderStatus) {
    const transitioned = await transitionOrder(db, {
      orderId: order.id,
      to: targetOrderStatus,
      reason: `Resultado financeiro ${input.provider}: ${event.type}`,
      actorLabel: input.actorLabel ?? `webhook:${input.provider}`,
    });
    if (!transitioned) {
      // Corrida: outro concorrente (webhook duplo, checkout) já levou o
      // pedido ao status alvo entre a leitura e o lock.
      return { applied: false, reason: "transition_noop", paymentStatus: targetPaymentStatus };
    }
    return {
      applied: true,
      paymentStatus: targetPaymentStatus,
      orderTransitioned: { from, to: targetOrderStatus },
    };
  }

  return { applied: true, paymentStatus: targetPaymentStatus };
}

/**
 * Recuperação de corrida checkout×webhook: o webhook pode chegar entre o
 * createPayment no provedor e o INSERT do pagamento local. O evento fica
 * gravado em payment_events (sem paymentId) — aqui ele é aplicado assim
 * que o pagamento existe.
 */
export async function applyPendingEventsForPayment(
  db: Db,
  input: { provider: string; payment: typeof schema.payments.$inferSelect; adapterParseWebhook: (raw: string) => NormalizedWebhookEvent },
): Promise<ApplyEventResult | null> {
  const pending = await db
    .select()
    .from(schema.paymentEvents)
    .where(and(eq(schema.paymentEvents.provider, input.provider), isNull(schema.paymentEvents.processedAt)));

  let last: ApplyEventResult | null = null;
  for (const row of pending) {
    let event: NormalizedWebhookEvent;
    try {
      event = input.adapterParseWebhook(JSON.stringify(row.payload));
    } catch {
      continue;
    }
    if (event.providerTransactionId !== input.payment.providerTransactionId) continue;

    last = await applyPaymentEvent(db, { provider: input.provider, event, payment: input.payment });
    await db
      .update(schema.paymentEvents)
      .set({ paymentId: input.payment.id, processedAt: new Date() })
      .where(eq(schema.paymentEvents.id, row.id));
  }
  return last;
}
