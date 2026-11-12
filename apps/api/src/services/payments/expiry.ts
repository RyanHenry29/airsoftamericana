// language: TS, file: apps/api/src/services/payments/expiry.ts, target: Fastify 5 + drizzle
/**
 * Expiração SEGURA de reservas (revisão v3, ponto C) — única implementação
 * sancionada do vazio deixado pelo AUD-04.
 *
 * Garantia central: a expiração NUNCA libera estoque de uma cobrança que
 * possa ser confirmada depois. Toda decisão automática de cancelamento é
 * precedida de consulta ao provedor (adapter.queryPaymentByOrder):
 *
 *   provedor NÃO conhece a cobrança (null)      → definitiva: cancela + libera
 *   provedor reports expirado/recusado/estornado → definitiva: cancela + libera
 *   provedor reports aprovado/autorizado         → aplica o resultado real
 *   provedor reports pendente                    → NÃO libera: cobrança viva;
 *                                                  webhook/reconciliação resolvem
 *   adapter sem consulta / consulta falha        → NÃO libera (jamais às cegas)
 *
 * Toda liberação de estoque passa por transitionOrderInTx dentro de
 * transação (mesma atomicidade do resto da máquina financeira).
 */
import { and, eq, lt, inArray } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { getAdapter, type QueryPaymentResult } from "./types.js";
import { initAdapters } from "./index.js";
import { transitionOrderInTx } from "../orders.js";
import { audit } from "../../lib/audit.js";

export interface ExpirySummary {
  scanned: number;
  cancelled: number;
  approved: number;
  skipped: number;
}

export async function expireStaleReservations(
  db: Db,
  opts: { olderThanMinutes?: number; limit?: number } = {},
): Promise<ExpirySummary> {
  await initAdapters(db);
  const olderThanMinutes = opts.olderThanMinutes ?? 60;

  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const stale = await db
    .select({ order: schema.orders, payment: schema.payments })
    .from(schema.orders)
    .innerJoin(schema.payments, eq(schema.payments.orderId, schema.orders.id))
    .where(
      and(
        inArray(schema.orders.status, ["aguardando_pagamento", "pagamento_em_processamento"]),
        inArray(schema.payments.status, ["pendente"]),
        lt(schema.orders.createdAt, cutoff),
      ),
    )
    .limit(opts.limit ?? 100);

  const summary: ExpirySummary = { scanned: stale.length, cancelled: 0, approved: 0, skipped: 0 };

  for (const { order, payment } of stale) {
    const adapter = getAdapter(payment.provider);

    // Sem consulta disponível: JAMAIS libera às cegas.
    if (!adapter?.queryPaymentByOrder) {
      summary.skipped++;
      await audit(db, {
        action: "expiry.skipped_no_query",
        entity: "order",
        entityId: order.id,
        actorLabel: "expiry:auto",
        after: { provider: payment.provider, reason: "adapter sem queryPaymentByOrder — reserva preservada" },
      });
      continue;
    }

    let remote: QueryPaymentResult | null;
    try {
      remote = await adapter.queryPaymentByOrder(order.id);
    } catch {
      remote = undefined as unknown as QueryPaymentResult | null;
    }
    if (remote === undefined || remote === null) {
      if (remote === undefined) {
        // Consulta falhou: resultado desconhecido — reserva preservada.
        summary.skipped++;
        await audit(db, {
          action: "expiry.skipped_unknown",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: { provider: payment.provider, reason: "consulta ao provedor falhou" },
        });
        continue;
      }
      // null = provedor CONFIRMA que não há cobrança: definitiva.
      await cancelOrder(db, order.id, "Reserva expirada: sem cobrança no provedor (confirmado por consulta)");
      summary.cancelled++;
      continue;
    }

    if (remote.status === "aprovado" || remote.status === "autorizado") {
      // Dinheiro entrou no provedor durante a reserva: aplica o resultado.
      await db
        .update(schema.payments)
        .set({
          status: remote.status,
          authorizedCents: remote.status === "autorizado" ? payment.amountCents : null,
          capturedAt: remote.status === "aprovado" ? new Date() : null,
        })
        .where(eq(schema.payments.id, payment.id));
      const to = remote.status === "aprovado" ? "pagamento_aprovado" : "pagamento_em_processamento";
      let transitioned = false;
      await db.transaction(async (tx) => {
        const outcome = await transitionOrderInTx(tx, {
          orderId: order.id,
          to,
          reason: "Cobrança confirmada pelo provedor durante expiração de reserva",
          actorLabel: "expiry:auto",
        });
        transitioned = outcome.transitioned;
      });
      if (transitioned) {
        summary.approved++;
        await audit(db, {
          action: "expiry.late_confirmation",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: { providerStatus: remote.status, to },
        });
      }
      continue;
    }

    if (remote.status === "expirado" || remote.status === "recusado" || remote.status === "estornado") {
      // Provedor é a fonte da verdade para o estado da cobrança.
      await db.update(schema.payments).set({ status: remote.status }).where(eq(schema.payments.id, payment.id));
      await cancelOrder(db, order.id, `Reserva expirada: cobrança ${remote.status} no provedor (confirmado por consulta)`);
      summary.cancelled++;
      continue;
    }

    // pendente: cobrança VIVA — estoque permanece reservado. O webhook
    // (aprovado/expirado) ou uma passada futura resolve; nunca às cegas.
    summary.skipped++;
    await audit(db, {
      action: "expiry.skipped_charge_alive",
      entity: "order",
      entityId: order.id,
      actorLabel: "expiry:auto",
      after: { provider: payment.provider, providerStatus: remote.status, reason: "cobrança pendente no provedor — reserva preservada" },
    });
  }

  return summary;
}

async function cancelOrder(db: Db, orderId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    await transitionOrderInTx(tx, {
      orderId,
      to: "cancelado",
      reason,
      actorLabel: "expiry:auto",
    });
  });
  await audit(db, {
    action: "expiry.cancelled",
    entity: "order",
    entityId: orderId,
    actorLabel: "expiry:auto",
    after: { reason },
  });
}
