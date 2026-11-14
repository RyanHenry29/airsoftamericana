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
import { and, eq, gt, isNull, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { getAdapter, type PaymentAdapter, type QueryPaymentResult } from "./types.js";
import { initAdapters } from "./index.js";
import { transitionOrderInTx } from "../orders.js";
import { audit } from "../../lib/audit.js";
import { conflict } from "../../lib/errors.js";
import { withSystemLock } from "./system-locks.js";
import { randomUUID } from "node:crypto";
import { canTransition, type OrderStatus } from "@airsoft/shared";

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
  /** Correção pós-revisão: pagamento tardio (pedido cancelado + dinheiro
   *  entrou) — assentado com registro durável de `refund_required`. */
  latePayment: number;
  /** Indicador operacional (revisão): pagamentos pendentes cujo pedido não
   *  aceita mais transição automática — exige investigação humana. Cada
   *  ocorrência tem registro individual `expiry.skipped_invalid_order_state`
   *  em audit_logs; este contador alimenta alertas no log de manutenção. */
  skippedInvalidState: number;
  /** Pagamentos pendentes cujo pedido NÃO EXISTE mais (estado cirúrgico/
   *  legado) — divergência financeira TRATÁVEL, nunca reconciliada
   *  automaticamente. Registro individual: `expiry.skipped_order_missing`. */
  skippedOrderMissing: number;
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
    latePayment: 0,
    skippedInvalidState: 0,
    skippedOrderMissing: 0,
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
        // Revalidação atômica: pagamento ainda pendente e ainda sem a
        // primeira observação. Persistência e auditoria na MESMA
        // transação — falha de auditoria reverte a marcação, nunca deixa
        // o campo registrado sem a trilha. O UPDATE só afeta se o campo
        // ainda estiver nulo (condição atômica contra corridas).
        const result = await db.transaction(async (tx) => {
          const [freshPayment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
          if (!freshPayment || freshPayment.status !== "pendente") return "skip";
          if (freshPayment.notFoundFirstSeenAt) {
            // Já tem primeira observação — verifica janela de confirmação
            // com o relógio do banco (mesma autoridade da gravação).
            const withinWindow = await tx
              .select({ withinWindow: sql<boolean>`${schema.payments.notFoundFirstSeenAt} > clock_timestamp() - ${confirmWindowMs}::bigint * interval '1 millisecond'` })
              .from(schema.payments)
              .where(eq(schema.payments.id, payment.id));
            const inWindow = withinWindow[0]?.withinWindow ?? false;
            if (inWindow) {
              summary.skippedConfirmWindow++;
              await audit(tx as unknown as Db, {
                action: "expiry.skipped_confirm_window",
                entity: "order",
                entityId: order.id,
                actorLabel: "expiry:auto",
                after: {
                  provider: payment.provider,
                  reason: "segunda observação antes da janela de confirmação — decisão adiada para a passada seguinte",
                  firstSeenAt: freshPayment.notFoundFirstSeenAt ?? null,
                  confirmWindowMs,
                },
              });
              return "skip_window"; // está na janela — pular para próximo pagamento
            }
            return "passed_window"; // passou da janela — segue para cancelar
          }
          const updated = await tx
            .update(schema.payments)
            .set({ notFoundFirstSeenAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(schema.payments.id, payment.id),
                eq(schema.payments.status, "pendente"),
                isNull(schema.payments.notFoundFirstSeenAt),
              ),
            );
          if ((updated.rowCount ?? 0) === 0) return "skip";
          summary.firstSeenRecorded++;
          await audit(tx as unknown as Db, {
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
          // Acabamos de definir a primeira observação — verifica imediatamente
          // se já está dentro da janela de confirmação (confirmWindowMs padrão
          // é 15 min, então uma observação persistida há instantes está dentro).
          const withinWindow2 = await tx
            .select({ withinWindow: sql<boolean>`${schema.payments.notFoundFirstSeenAt} > clock_timestamp() - ${confirmWindowMs}::bigint * interval '1 millisecond'` })
            .from(schema.payments)
            .where(eq(schema.payments.id, payment.id));
          const inWindow2 = withinWindow2[0]?.withinWindow ?? false;
          if (inWindow2) {
            summary.skippedConfirmWindow++;
            await audit(tx as unknown as Db, {
              action: "expiry.skipped_confirm_window",
              entity: "order",
              entityId: order.id,
              actorLabel: "expiry:auto",
              after: {
                provider: payment.provider,
                reason: "segunda observação antes da janela de confirmação — decisão adiada para a passada seguinte",
                firstSeenAt: freshPayment.notFoundFirstSeenAt ?? null,
                confirmWindowMs,
              },
            });
            return "skip_window"; // está na janela — pular para próximo pagamento
          }
          return "defined"; // definiu agora — prosseguir para verificação de grace abaixo
        });
        if (result === "skip" || result === "skip_window") continue;
        if (result === "defined") continue;
        // result === "passed_window": passou da janela de confirmação —
        // prosseguir para cancelar (finalizeExpiry com toOrderStatus: "cancelado").
        // result === "defined": primeira observação definida agora — prosseguir
        // para verificação de grace abaixo (não cancela nesta passada, apenas
        // registra a primeira observação).
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
      } else if (settled.orderMissing) {
        // Pagamento pendente sem pedido correspondente — divergência
        // financeira TRATÁVEL (âncora: registro no pagamento; o id do
        // pedido não existe mais). Nunca assenta, nunca reconcilia.
        summary.skipped++;
        summary.skippedOrderMissing++;
        await audit(db, {
          action: "expiry.skipped_order_missing",
          entity: "payment",
          entityId: payment.id,
          actorLabel: "expiry:auto",
          after: {
            orderId: order.id,
            provider: payment.provider,
            providerStatus: "expirado",
            reason: "pagamento pendente sem pedido correspondente — divergência financeira tratável; investigação humana",
          },
        });
      } else if (settled.refused) {
        // Estado do pedido não permite cancelamento automático — pagamento
        // permanece `pendente`; sinal operacional para investigação humana.
        summary.skipped++;
        summary.skippedInvalidState++; // indicador operacional (revisão)
        await audit(db, {
          action: "expiry.skipped_invalid_order_state",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: {
            provider: payment.provider,
            orderStatus: settled.orderStatus,
            reason: "transição recusada pelo estado do pedido — assentamento automático proibido; investigação humana",
          },
        });
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
      if (settled.latePayment) {
        // Correção pós-revisão: pedido cancelado + dinheiro entrou —
        // assentado com refund_required durável (dentro de finalizeExpiry).
        summary.latePayment++;
      } else if (settled.transitioned) {
        summary.approved++;
      } else if (settled.orderMissing) {
        // Pagamento pendente sem pedido correspondente — divergência
        // financeira TRATÁVEL (âncora: registro no pagamento; o id do
        // pedido não existe mais). Nunca assenta, nunca reconcilia.
        summary.skipped++;
        summary.skippedOrderMissing++;
        await audit(db, {
          action: "expiry.skipped_order_missing",
          entity: "payment",
          entityId: payment.id,
          actorLabel: "expiry:auto",
          after: {
            orderId: order.id,
            provider: payment.provider,
            providerStatus: remote.status,
            reason: "pagamento pendente sem pedido correspondente — divergência financeira tratável; investigação humana",
          },
        });
      } else if (settled.refused) {
        // Estado do pedido não permite assentamento automático — pagamento
        // permanece `pendente`; sinal operacional para investigação humana.
        summary.skipped++;
        summary.skippedInvalidState++; // indicador operacional (revisão)
        await audit(db, {
          action: "expiry.skipped_invalid_order_state",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: {
            provider: payment.provider,
            providerStatus: remote.status,
            orderStatus: settled.orderStatus,
            reason: "transição recusada pelo estado do pedido — assentamento automático proibido; investigação humana",
          },
        });
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
      } else if (settled.orderMissing) {
        // Pagamento pendente sem pedido correspondente — divergência
        // financeira TRATÁVEL (âncora: registro no pagamento; o id do
        // pedido não existe mais). Nunca assenta, nunca reconcilia.
        summary.skipped++;
        summary.skippedOrderMissing++;
        await audit(db, {
          action: "expiry.skipped_order_missing",
          entity: "payment",
          entityId: payment.id,
          actorLabel: "expiry:auto",
          after: {
            orderId: order.id,
            provider: payment.provider,
            providerStatus: remote.status,
            reason: "pagamento pendente sem pedido correspondente — divergência financeira tratável; investigação humana",
          },
        });
      } else if (settled.refused) {
        // Estado do pedido não permite cancelamento automático — pagamento
        // permanece `pendente`; sinal operacional para investigação humana.
        summary.skipped++;
        summary.skippedInvalidState++; // indicador operacional (revisão)
        await audit(db, {
          action: "expiry.skipped_invalid_order_state",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: {
            provider: payment.provider,
            providerStatus: remote.status,
            orderStatus: settled.orderStatus,
            reason: "transição recusada pelo estado do pedido — assentamento automático proibido; investigação humana",
          },
        });
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
 * → DECISÃO pelo estado do pedido (correção pós-revisão), antes de
 * qualquer escrita → update do pagamento → transição do pedido com lock
 * FOR UPDATE (ordem canônica pagamento→pedido, sem deadlocks com o
 * webhook) → auditoria DENTRO da transação. Crash em qualquer ponto =
 * rollback total.
 *
 * Correção pós-revisão — comportamento definido POR ESTADO DO PEDIDO:
 *  - pedido cancelado + cobrança APROVADA no provedor: pagamento tardio —
 *    assenta o pagamento (dinheiro entrou) com registro durável de
 *    `refund_required` (order.late_payment, mesma semântica da rota de
 *    webhook); pedido NÃO reabre; NENHUMA transição é registrada.
 *  - transição obrigatória recusada (estado não-transicionável): NADA é
 *    assentado — pagamento permanece `pendente` para investigação humana
 *    (a recusa acontece ANTES de qualquer escrita: nada a desfazer).
 *  - pedido já no status alvo (from === to): reconciliação — pagamento
 *    assentado SEM registrar transição e SEM auditoria de confirmação
 *    tardia (ação própria: expiry.payment_reconciled).
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
): Promise<{ paymentSettled: boolean; transitioned: boolean; latePayment?: boolean; refused?: boolean; orderMissing?: boolean; orderStatus?: OrderStatus | null }> {
  return db.transaction(
    async (tx): Promise<{ paymentSettled: boolean; transitioned: boolean; latePayment?: boolean; refused?: boolean; orderMissing?: boolean; orderStatus?: OrderStatus | null }> => {
      const payRows = await tx.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId)).for("update");
      const payment = payRows[0];
      if (!payment || payment.status !== "pendente") {
        // Webhook/admin resolveu na janela entre consulta e transação — este
        // caminho NÃO toca o estado (o dono da resolução já audita).
        return { paymentSettled: false, transitioned: false };
      }

      // Ordem canônica de locks: pagamento lockado → pedido lockado. A
      // DECISÃO acontece com o estado real sob lock, ANTES de qualquer
      // escrita — recusa não tem nada a desfazer. O pedido é SEMPRE
      // lockado (os três callers informam orderId) — pedido inexistente
      // é decisão própria, nunca "reconciliação".
      const rows = await tx.select().from(schema.orders).where(eq(schema.orders.id, input.orderId)).for("update");
      const order = rows[0] ?? null;
      const from = (order?.status ?? null) as OrderStatus | null;

      // Pedido INEXISTENTE (estado cirúrgico/legado — a FK payments→orders
      // impede que surja por operação normal): NADA é assentado. Dinheiro
      // sem pedido é divergência financeira TRATÁVEL por humano — nunca
      // classificada automaticamente como reconciliação.
      if (!order) {
        return { paymentSettled: false, transitioned: false, refused: true, orderMissing: true, orderStatus: null };
      }

      // Pagamento tardio: pedido cancelado + dinheiro entrou. Estado NÃO
      // reabre; registro durável de refund_required DENTRO da transação.
      if (order && from === "cancelado" && input.paymentStatus === "aprovado") {
        await settleExpiryPayment(tx, input);
        await audit(tx as unknown as Db, {
          action: "order.late_payment",
          entity: "order",
          entityId: order.id,
          actorLabel: "expiry:auto",
          after: {
            paymentId: payment.id,
            providerTransactionId: payment.providerTransactionId,
            amountCents: payment.amountCents,
            decision: "refund_required",
            source: "expiry",
          },
        });
        return { paymentSettled: true, transitioned: false, latePayment: true };
      }

      // Transição obrigatória recusada: NADA é assentado. O pagamento
      // permanece `pendente` — divergência legada exige investigação humana.
      if (order && from !== input.toOrderStatus && !canTransition(from!, input.toOrderStatus!)) {
        return { paymentSettled: false, transitioned: false, refused: true, orderStatus: from };
      }

      await settleExpiryPayment(tx, input);

      let transitioned = false;
      if (input.toOrderStatus && from !== input.toOrderStatus) {
        const outcome = await transitionOrderInTx(tx as unknown as Db, {
          orderId: input.orderId,
          to: input.toOrderStatus,
          reason: input.reason,
          actorLabel: "expiry:auto",
        });
        // Fail-closed (revisão): uma transição OBRIGATÓRIA que não ocorreu
        // NUNCA convive com pagamento assentado — aqui é impossível por
        // construção (from ≠ alvo garantido acima, mesma linha lockada na
        // mesma transação), e a guarda garante que permaneça impossível:
        // qualquer recusa inesperada reverte TUDO.
        if (!outcome.transitioned) throw conflict("invalid_transition", "transição obrigatória não ocorreu — nada é assentado");
        transitioned = true;
      }

      if (transitioned) {
        // Auditoria DENTRO da transação — registro e estado entram/saem juntos.
        await audit(tx as unknown as Db, {
          action: input.auditAction ?? "expiry.cancelled",
          entity: "order",
          entityId: input.orderId,
          actorLabel: "expiry:auto",
          after: input.auditAfter ?? { reason: input.reason, paymentStatus: input.paymentStatus },
        });
      } else if (input.toOrderStatus) {
        // Assentamento SEM transição (pedido já no alvo ou pedido ausente):
        // auditoria PRÓPRIA de reconciliação — nunca late_confirmation como
        // se a transição tivesse ocorrido.
        await audit(tx as unknown as Db, {
          action: "expiry.payment_reconciled",
          entity: "order",
          entityId: order?.id ?? input.orderId,
          actorLabel: "expiry:auto",
          after: { reason: input.reason, paymentStatus: input.paymentStatus, orderStatus: from },
        });
      }
      return { paymentSettled: true, transitioned };
    },
  );
}

/** Assentamento do pagamento dentro da transação (v5, item 5). */
async function settleExpiryPayment(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  input: {
    paymentId: string;
    paymentStatus: "aprovado" | "autorizado" | "expirado" | "recusado" | "estornado";
    authorizedCents?: number | null;
    captured?: boolean;
  },
): Promise<void> {
  await (tx as unknown as Db)
    .update(schema.payments)
    .set({
      status: input.paymentStatus,
      authorizedCents: input.paymentStatus === "autorizado" ? (input.authorizedCents ?? null) : null,
      capturedAt: input.captured ? new Date() : null,
      // Assentamento invalida a observação de ausência (revisão v5):
      // sem estado obsoleto reutilizável após mudança de estado.
      notFoundFirstSeenAt: null,
    })
    .where(eq(schema.payments.id, input.paymentId));
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
  runOnce: (ctx: { lost: () => boolean; lockName: string; leaseToken: string }) => Promise<unknown>,
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
      .catch((err) => {
        // Falha de manutenção NÃO derruba o processo; próxima passada tenta.
        // Nunca silenciar: registro estruturado com nome de fase, id de
        // execução e pilha higienizada para o log de manutenção.
        const executionId = randomUUID();
        const stack = err instanceof Error ? (err.stack ?? "").split("\n").slice(1, 6).join("\n") : String(err);
        console.error(
          JSON.stringify({
            phase: "payment_maintenance",
            executionId,
            lockName,
            error: err instanceof Error ? err.message : String(err),
            stack,
            timestamp: new Date().toISOString(),
          }),
        );
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
