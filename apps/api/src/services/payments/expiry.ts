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
import { withSystemLock } from "./system-locks.js";
import { type OrderStatus } from "@airsoft/shared";

export interface ExpirySummary {
  scanned: number;
  cancelled: number;
  approved: number;
  skipped: number;
  /** Consultas inconclusivas mesmo após retentativas. */
  skippedUnknown: number;
  /** `null` do provedor dentro da tolerância — reserva preservada. */
  skippedNotFoundGrace: number;
  /** Revisão v5 (item 4): primeira observação `null` persistida. */
  firstSeenRecorded: number;
  /** Revisão v5 (item 4): `null` com primeira observação recente — janela de
   *  consistência ainda não decorrida; confirmação independente virá na
   *  passada seguinte. */
  skippedConfirmWindow: number;
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
  opts: {
    olderThanMinutes?: number;
    notFoundGraceMinutes?: number;
    /** Janela mínima entre a primeira observação `null` e a confirmação
     *  independente (default = intervalo de manutenção): dois `null` em
     *  passadas distintas são independentes; na mesma passada, não. */
    confirmWindowMs?: number;
    limit?: number;
  } = {},
): Promise<ExpirySummary> {
  await initAdapters(db);
  const olderThanMinutes = opts.olderThanMinutes ?? 60;
  const notFoundGraceMinutes = opts.notFoundGraceMinutes ?? 24 * 60;
  const confirmWindowMs = opts.confirmWindowMs ?? 15 * 60 * 1000;

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
    firstSeenRecorded: 0,
    skippedConfirmWindow: 0,
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
      // Revisão v5 (item 4): a primeira observação `null` é PERSISTIDA —
      // a decisão nunca depende de dois `null` na mesma passada. A próxima
      // passada (janela = intervalo de manutenção) reconsulta: só então as
      // duas observações são independentes.
      if (!payment.notFoundFirstSeenAt) {
        await db
          .update(schema.payments)
          .set({ notFoundFirstSeenAt: new Date() })
          .where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, "pendente")));
        summary.firstSeenRecorded++;
        await audit(db, {
          action: "expiry.notfound_first_seen",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: {
            provider: payment.provider,
            reason: "provedor não conhece a cobrança — observação persistida; confirmação independente na passada seguinte",
            graceMinutes: notFoundGraceMinutes,
          },
        });
      }
      // Tolerância: dentro do grace, resposta negativa NÃO cancela —
      // consistência eventual do gateway preservada (v4).
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
      // Janela de confirmação: a observação persistida é recente — este
      // `null` não é independente do primeiro; a passada seguinte decide.
      // RE-LEITURA: o scan leu a linha ANTES de persistir a primeira
      // observação — a janela julga o estado real do banco.
      const [freshPayment] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
      const firstSeen = freshPayment?.notFoundFirstSeenAt?.getTime() ?? 0;
      if (Date.now() - firstSeen < confirmWindowMs) {
        summary.skippedConfirmWindow++;
        await audit(db, {
          action: "expiry.skipped_confirm_window",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: {
            provider: payment.provider,
            reason: "segunda observação antes da janela de confirmação — decisão adiada para a passada seguinte",
            firstSeenAt: freshPayment?.notFoundFirstSeenAt ?? null,
            confirmWindowMs,
          },
        });
        continue;
      }
      // Tolerância vencida + duas observações independentes (passadas
      // distintas), ambas `null`: ausência definitiva — cancela com estoque
      // livre, atomicamente (v5, item 5).
      const settled = await finalizeExpiry(db, {
        paymentId: payment.id,
        orderId: order.id,
        paymentStatus: "expirado",
        toOrderStatus: "cancelado",
        reason: "Reserva expirada: sem cobrança no provedor (duas observações independentes após tolerância)",
      });
      if (settled.transitioned) {
        summary.cancelled++;
      } else {
        summary.skipped++; // webhook/admin venceu a corrida
      }
      continue;
    }

    if (remote !== null && (remote.status === "aprovado" || remote.status === "autorizado")) {
      // Revisão v5 (item 5): decisão, atualização do pagamento, transição do
      // pedido, histórico e estoque em UMA transação — pagamento lockado
      // ANTES do pedido (ordem canônica pagamento→pedido). Guarda por
      // `status='pendente'` sob lock: webhook que resolveu na janela vence.
      const settled = await finalizeExpiry(db, {
        paymentId: payment.id,
        orderId: order.id,
        paymentStatus: remote.status,
        authorizedCents: remote.status === "autorizado" ? payment.amountCents : null,
        captured: remote.status === "aprovado",
        toOrderStatus: remote.status === "aprovado" ? "pagamento_aprovado" : "pagamento_em_processamento",
        reason: "Cobrança confirmada pelo provedor durante expiração de reserva",
        auditAfter: { providerStatus: remote.status, to: remote.status === "aprovado" ? "pagamento_aprovado" : "pagamento_em_processamento" },
        auditAction: "expiry.late_confirmation",
      });
      if (settled.transitioned) {
        summary.approved++;
      } else {
        summary.skipped++; // resolvido por webhook/admin na janela
      }
      continue;
    }

    if (remote !== null && (remote.status === "expirado" || remote.status === "recusado" || remote.status === "estornado")) {
      // Provedor é a fonte da verdade para o estado da cobrança — mesmo
      // caminho atômico (v5, item 5): guarda sob lock do pagamento.
      const settled = await finalizeExpiry(db, {
        paymentId: payment.id,
        orderId: order.id,
        paymentStatus: remote.status,
        toOrderStatus: "cancelado",
        reason: `Reserva expirada: cobrança ${remote.status} no provedor (confirmado por consulta)`,
      });
      if (settled.transitioned) {
        summary.cancelled++;
      } else {
        summary.skipped++; // webhook/admin venceu a corrida
      }
      continue;
    }

    if (remote === null) {
      // Passou pela tolerância + duas observações independentes, ambos
      // null: ausência definitiva — cancela com estoque livre (acima).
      summary.skipped++;
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

/**
 * Revisão v5 (item 5): decisão de expiração ATÔMICA. Consulta externa ao
 * gateway NÃO participa (já aconteceu, fora da transação). Dentro de UMA
 * transação: pagamento lockado (FOR UPDATE) e revalidado como `pendente`
 * → update do pagamento → transição do pedido com lock FOR UPDATE
 * (ordem canônica pagamento→pedido, sem deadlocks com o webhook) →
 * auditoria DENTRO da transação. Crash em qualquer ponto = rollback
 * total: sem pagamento atualizado com pedido parado, sem estoque liberado
 * sem pedido cancelado, sem auditoria órfã.
 */
async function finalizeExpiry(
  db: Db,
  input: {
    paymentId: string;
    orderId: string;
    paymentStatus: "aprovado" | "autorizado" | "expirado" | "recusado" | "estornado";
    authorizedCents?: number | null;
    captured?: boolean;
    toOrderStatus: OrderStatus | null;
    reason: string;
    auditAction?: string;
    auditAfter?: unknown;
  },
): Promise<{ paymentSettled: boolean; transitioned: boolean }> {
  return db.transaction(async (tx): Promise<{ paymentSettled: boolean; transitioned: boolean }> => {
    const payRows = await tx.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId)).for("update");
    const payment = payRows[0];
    if (!payment || payment.status !== "pendente") {
      // Webhook/admin resolveu na janela entre consulta e transação — este
      // caminho NÃO toca o estado (o dono da resolução já audita).
      return { paymentSettled: false, transitioned: false };
    }
    await tx
      .update(schema.payments)
      .set({
        status: input.paymentStatus,
        authorizedCents: input.paymentStatus === "autorizado" ? (input.authorizedCents ?? null) : null,
        capturedAt: input.captured ? new Date() : null,
      })
      .where(eq(schema.payments.id, payment.id));

    let transitioned = false;
    if (input.toOrderStatus) {
      const outcome = await transitionOrderInTx(tx as unknown as Db, {
        orderId: input.orderId,
        to: input.toOrderStatus,
        reason: input.reason,
        actorLabel: "expiry:auto",
      });
      transitioned = outcome.transitioned;
    }

    // Auditoria DENTRO da transação — registro e estado entram/saem juntos.
    if (transitioned || input.auditAction) {
      await audit(tx as unknown as Db, {
        action: input.auditAction ?? "expiry.cancelled",
        entity: "order",
        entityId: input.orderId,
        actorLabel: "expiry:auto",
        after: input.auditAfter ?? { reason: input.reason, paymentStatus: input.paymentStatus },
      });
    }
    return { paymentSettled: true, transitioned };
  });
}

/**
 * Varrimento periódico (v5): boot sozinho não cobre processos longevos —
 * reservas abandonadas com a aplicação ligada ficariam sem tratamento.
 * Intervalo default 15 min, com flag de não-reentrância local (passada
 * longa não se sobrepõe no MESMO processo) e LEASE DE BANCO entre
 * INSTÂNCIAS (`system_locks`, revisão v5 item 3): cada passada adquirirá
 * o lock `payment_maintenance` ativamente — instância que não o detém
 * pula a passada inteira; a detentora roda com renovação em heartbeat.
 * Intervalo solto no fim do processo (unref).
 */
export function startPaymentMaintenance(
  db: Db,
  runOnce: () => Promise<unknown>,
  opts: { intervalMs?: number; lockTtlMs?: number; lockName?: string } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 15 * 60 * 1000;
  const lockTtlMs = opts.lockTtlMs ?? 5 * 60 * 1000;
  const lockName = opts.lockName ?? "payment_maintenance";
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // passada anterior ainda em curso NESTE processo
    running = true;
    void withSystemLock(db, lockName, lockTtlMs, runOnce)
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
