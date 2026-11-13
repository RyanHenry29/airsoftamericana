// language: TS, file: apps/api/src/services/payments/expiry.ts, target: Fastify 5 + drizzle
/**
 * Expiração SEGURA de reservas — única implementação sancionada do vazio
 * deixado pelo AUD-04 até o job agendado dedicado. Endurecida na revisão v4:
 *
 * Garantia central: a expiração NUNCA libera estoque de uma cobrança que
 * possa ser confirmada depois. Toda decisão automática de cancelamento é
 * precedida de consulta ao provedor (adapter.queryPaymentByOrder):
 *
 *   provedor NÃO conhece a cobrança (null)        → TOLERÂNCIA (grace):
 *       só tratada como definitiva APÓS `notFoundGraceMinutes` da criação do
 *       pedido (default 24 h) E com dupla confirmação (2ª consulta imediata
 *       ainda null). Provedores com consistência eventual não derrubam
 *       reserva por resposta negativa precoce.
 *   provedor reports expirado/recusado/estornado  → definitiva: cancela + libera
 *   provedor reports aprovado/autorizado          → aplica o resultado real
 *   provedor reports pendente                     → NÃO libera: cobrança viva
 *   consulta falha (após 2 retentativas)          → NÃO libera (jamais às cegas)
 *   adapter sem consulta                          → NÃO libera
 *
 * IDEMPOTÊNCIA entre expiração e confirmação tardia:
 *  - update do pagamento é GUARDADO por `status = 'pendente'` (RETURNING
 *    verifica). Webhook que resolveu a cobrança na janela vence a expiração.
 *  - transição passa por `transitionOrderInTx` (FOR UPDATE) — segunda
 *    instância/expiração concorrente vê `transitioned=false` e não audita;
 *    estoque liberado UMA vez, dentro da mesma transação.
 *
 * AGENDAMENTO: hook de boot + varrimento periódico (`startPaymentMaintenance`
 * em apps/api/index.ts, default 15 min, com flag de não-reentrância). O hook
 * de boot sozinho não cobre processos longevos — o intervalo sim.
 */
import { and, eq, lt, inArray } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { getAdapter, type PaymentAdapter, type QueryPaymentResult } from "./types.js";
import { initAdapters } from "./index.js";
import { transitionOrderInTx } from "../orders.js";
import { audit } from "../../lib/audit.js";

export interface ExpirySummary {
  scanned: number;
  cancelled: number;
  approved: number;
  skipped: number;
  /** Consultas inconclusivas mesmo após retentativas. */
  skippedUnknown: number;
  /** `null` do provedor dentro da tolerância — reserva preservada. */
  skippedNotFoundGrace: number;
}

const QUERY_RETRIES = 2;
const RETRY_DELAY_MS = 500;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Consulta com retentativa curta — falha transitória não vira decisão. */
async function queryWithRetry(
  adapter: PaymentAdapter,
  orderId: string,
): Promise<{ ok: true; result: QueryPaymentResult | null } | { ok: false }> {
  for (let attempt = 0; attempt <= QUERY_RETRIES; attempt++) {
    try {
      return { ok: true, result: await adapter.queryPaymentByOrder!(orderId) };
    } catch {
      if (attempt < QUERY_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  return { ok: false };
}

export async function expireStaleReservations(
  db: Db,
  opts: { olderThanMinutes?: number; notFoundGraceMinutes?: number; limit?: number } = {},
): Promise<ExpirySummary> {
  await initAdapters(db);
  const olderThanMinutes = opts.olderThanMinutes ?? 60;
  const notFoundGraceMinutes = opts.notFoundGraceMinutes ?? 24 * 60;

  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const graceCutoff = new Date(Date.now() - notFoundGraceMinutes * 60 * 1000);
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

  const summary: ExpirySummary = {
    scanned: stale.length,
    cancelled: 0,
    approved: 0,
    skipped: 0,
    skippedUnknown: 0,
    skippedNotFoundGrace: 0,
  };

  for (const { order, payment } of stale) {
    // Cast para a interface: união de classes concretas intersecciona
    // assinaturas de método (implementações podem omitir o parâmetro).
    const adapter = getAdapter(payment.provider) as PaymentAdapter | undefined;

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

    const queried = await queryWithRetry(adapter, order.id);
    if (!queried.ok) {
      // Consulta falhou após retentativas: resultado desconhecido — reserva preservada.
      summary.skippedUnknown++;
      await audit(db, {
        action: "expiry.skipped_unknown",
        entity: "order",
        entityId: order.id,
        actorLabel: "expiry:auto",
        after: { provider: payment.provider, reason: "consulta ao provedor falhou após retentativas" },
      });
      continue;
    }
    let remote = queried.result;

    if (remote === null) {
      // Provedor reporta ausência. Tolerância: dentro do grace, resposta
      // negativa precoce NÃO cancela — consistência eventual preservada.
      if (order.createdAt.getTime() > graceCutoff.getTime()) {
        summary.skippedNotFoundGrace++;
        await audit(db, {
          action: "expiry.skipped_notfound_grace",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: {
            provider: payment.provider,
            reason: "provedor não conhece a cobrança, mas pedido dentro da tolerância — reserva preservada",
            graceMinutes: notFoundGraceMinutes,
          },
        });
        continue;
      }
      // Dupla confirmação: 2ª consulta imediata — blip de consistência
      // eventual não vira cancelamento.
      try {
        remote = await adapter.queryPaymentByOrder(order.id);
      } catch {
        summary.skippedUnknown++;
        await audit(db, {
          action: "expiry.skipped_unknown",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: { provider: payment.provider, reason: "2ª confirmação falhou — reserva preservada" },
        });
        continue;
      }
      if (remote !== null) {
        // Apareceu entre as consultas: segue com o resultado real (abaixo).
        // null→pendente fica no ramo de cobrança viva; null→aprovado no de aprovação.
      }
    }

    if (remote !== null && (remote.status === "aprovado" || remote.status === "autorizado")) {
      // Update GUARDADO por status pendente: webhook que resolveu na janela
      // vence — sem overwrite, sem dupla contagem. Verificação por re-leitura
      // (o drizzle PGlite desta casa não aceita returning com colunas aqui).
      await db
        .update(schema.payments)
        .set({
          status: remote.status,
          authorizedCents: remote.status === "autorizado" ? payment.amountCents : null,
          capturedAt: remote.status === "aprovado" ? new Date() : null,
        })
        .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, "pendente")));
      const [afterGuard] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
      if (afterGuard!.status !== remote.status) {
        summary.skipped++; // resolvido por webhook/reparo na janela
        continue;
      }
      const to = remote.status === "aprovado" ? "pagamento_aprovado" : "pagamento_em_processamento";
      let transitioned = false;
      await db.transaction(async (tx) => {
        const outcome = await transitionOrderInTx(tx as unknown as Db, {
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

    if (remote !== null && (remote.status === "expirado" || remote.status === "recusado" || remote.status === "estornado")) {
      // Provedor é a fonte da verdade para o estado da cobrança. Guardado:
      // só assume o estado se o pagamento ainda está pendente.
      await db
        .update(schema.payments)
        .set({ status: remote.status })
        .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, "pendente")));
      const [afterGuard] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
      if (afterGuard!.status !== remote.status) {
        summary.skipped++; // resolvido por webhook na janela
        continue;
      }
      if (await cancelOrder(db, order.id, `Reserva expirada: cobrança ${remote.status} no provedor (confirmado por consulta)`)) {
        summary.cancelled++;
      } else {
        summary.skipped++; // transição vencida por outra instância
      }
      continue;
    }

    if (remote === null) {
      // Passou pela tolerância + dupla confirmação, ambos null: ausência
      // definitiva — cancela com estoque livre.
      if (await cancelOrder(db, order.id, "Reserva expirada: sem cobrança no provedor (dupla confirmação após tolerância)")) {
        summary.cancelled++;
      } else {
        summary.skipped++; // transição vencida por outra instância
      }
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

async function cancelOrder(db: Db, orderId: string, reason: string): Promise<boolean> {
  let transitioned = false;
  await db.transaction(async (tx) => {
    const outcome = await transitionOrderInTx(tx as unknown as Db, {
      orderId,
      to: "cancelado",
      reason,
      actorLabel: "expiry:auto",
    });
    transitioned = outcome.transitioned;
  });
  // Audita somente quem transicionou — segunda instância em corrida vê
  // transitioned=false e não duplica auditoria.
  if (transitioned) {
    await audit(db, {
      action: "expiry.cancelled",
      entity: "order",
      entityId: orderId,
      actorLabel: "expiry:auto",
      after: { reason },
    });
  }
  return transitioned;
}

/**
 * Varrimento periódico (v4): boot sozinho não cobre processos longevos —
 * reservas abandonadas com a aplicação ligada ficariam sem tratamento.
 * Intervalo default 15 min, com flag de não-reentrância (passada longa não
 * se sobrepõe) e intervalo solto no fim do processo (unref).
 */
export function startPaymentMaintenance(
  db: Db,
  runOnce: () => Promise<unknown>,
  opts: { intervalMs?: number } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 15 * 60 * 1000;
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // passada anterior ainda em curso — não reentrante
    running = true;
    runOnce()
      .catch(() => {
        // falha de manutenção não derruba o processo; próxima passada tenta
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
