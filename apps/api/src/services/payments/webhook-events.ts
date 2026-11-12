// language: TS, file: apps/api/src/services/payments/webhook-events.ts, target: Fastify 5 + drizzle
/**
 * Aplicação de eventos de pagamento ao estado local (AUD-15).
 *
 * Único ponto que transforma o RESULTADO FINANCEIRO do provedor em estado
 * do pedido — usado pelo webhook, pela recuperação de corrida do checkout
 * e pela recuperação no boot.
 *
 * Regras v2 (revisão do PR):
 *  - ATOMICIDADE: pagamento + pedido + histórico + estoque + marcação do
 *    evento (`processed_at`) acontecem em UMA transação. Crash no meio = nada
 *    aplicado; o evento permanece `processed_at IS NULL` e é reaplicado pela
 *    reentrega ou pelo boot (recoverPendingEvents).
 *  - `processedAt` só é gravado DEPOIS/DENTRO da efetivação — nunca antes.
 *  - Validação financeira antes de aprovar: valor, moeda, referência externa
 *    e conta do estabelecimento. Dados insuficientes ⇒ consulta o gateway
 *    (adapter.queryPayment). Divergência ⇒ evento NÃO é aplicado, fica
 *    pendente para investigação (nunca vira aprovação).
 *  - O pagamento NUNCA regride: `aprovado`/`estornado` não são sobrescritos
 *    por recusado/expirado.
 *  - PIX/boleto confirmados só aprovam o pedido via evento; a criação da
 *    cobrança não aprova nada.
 *  - Pagamento aprovado sobre pedido CANCELADO = pagamento tardio: estado do
 *    pedido preservado, alerta de estorno gerado, estorno NUNCA automático.
 *  - Reparo de estados parciais legados (v1 pré-transação): pagamento já
 *    atualizado + pedido não — consertado na inicialização.
 */
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import type { NormalizedWebhookEvent } from "./types.js";
import { getAdapter, loadGatewayConfig, decryptCredentials } from "./types.js";
import { initAdapters } from "./index.js";
import { transitionOrderInTx } from "../orders.js";
import { audit } from "../../lib/audit.js";
import { PAYMENT_PENDING_STATUSES, type OrderStatus } from "@airsoft/shared";

export interface ApplyEventResult {
  applied: boolean;
  reason?: string;
  paymentStatus?: string;
  orderTransitioned?: { from: OrderStatus; to: OrderStatus };
  latePayment?: boolean;
}

interface AuditPending {
  action: string;
  entity: string;
  entityId: string | null;
  actorLabel?: string | null;
  after?: unknown;
}

type TargetPaymentStatus = "aprovado" | "recusado" | "expirado" | "estornado";

function targetPaymentStatusFor(type: NormalizedWebhookEvent["type"]): TargetPaymentStatus {
  switch (type) {
    case "payment.approved":
      return "aprovado";
    case "payment.recused":
      return "recusado";
    case "payment.expired":
      return "expirado";
    default:
      return "estornado";
  }
}

/**
 * Validação financeira pré-transação (ponto 4 da revisão). Devolve uma
 * objeção quando o evento não pode virar aprovação; consulta o gateway
 * quando o webhook não traz dados suficientes.
 */
async function validateFinancialEvent(
  db: Db,
  input: {
    provider: string;
    event: NormalizedWebhookEvent;
    payment: typeof schema.payments.$inferSelect;
  },
): Promise<{ ok: true } | { ok: false; reason: string; detail: unknown }> {
  const { event, payment } = input;

  // Referência externa: o evento deve apontar para ESTA cobrança.
  if (event.providerTransactionId && payment.providerTransactionId && event.providerTransactionId !== payment.providerTransactionId) {
    return { ok: false, reason: "transaction_mismatch", detail: { event: event.providerTransactionId, payment: payment.providerTransactionId } };
  }

  // Moeda: só aceita BRL — gateway qualquer outra coisa é configuração errada.
  if (event.currency && event.currency.toUpperCase() !== "BRL") {
    return { ok: false, reason: "currency_mismatch", detail: { currency: event.currency } };
  }

  // Referência externa do pedido, quando o provedor ecoa a nossa.
  if (event.externalReference && event.externalReference !== payment.orderId) {
    return { ok: false, reason: "external_reference_mismatch", detail: { event: event.externalReference, order: payment.orderId } };
  }

  // ---- Vinculação da conta do estabelecimento (revisão v3, ponto D).
  // Política: um identificador QUE EXISTE não pode ficar sem verificação.
  //   claim presente + esperado configurado + divergente  → account_mismatch
  //   claim presente + esperado AUSENTE nas credenciais   → account_unverified
  //       (não aprova silenciosamente: configure accountId nas credenciais
  //        do gateway para vincular — correção é configuração, não código)
  //   esperado configurado + claim AUSENTE no evento (approved) → account_binding_missing
  //       (gateway configurado para vincular deve ecoar o identificador)
  //   nenhum dos lados informa → aprovação NÃO silenciosa: audita
  //       payment.account_binding_missing como advertência; as demais
  //       validações (transação, moeda, valor, referência) continuam válidas.
  let expectedAccount: string | undefined;
  try {
    const cfg = await loadGatewayConfig(db, input.provider);
    if (cfg?.credentialsEncrypted) {
      const creds = decryptCredentials(cfg);
      expectedAccount = creds.accountId;
    }
  } catch {
    // credencial ilegível: validação de conta indisponível — as demais validam.
  }

  if (event.accountId) {
    if (!expectedAccount) {
      return {
        ok: false,
        reason: "account_unverified",
        detail: { event: event.accountId, guidance: "configure accountId nas credenciais do gateway" },
      };
    }
    if (event.accountId !== expectedAccount) {
      return { ok: false, reason: "account_mismatch", detail: { event: event.accountId, expected: "***" } };
    }
  } else if (expectedAccount && event.type === "payment.approved") {
    return {
      ok: false,
      reason: "account_binding_missing",
      detail: { expectedConfigured: true, guidance: "evento aprovado sem identificador de conta em gateway configurado para vincular" },
    };
  } else if (!expectedAccount && event.type === "payment.approved") {
    // Nenhum dos lados informa conta: aprovação NUNCA silenciosa.
    await audit(db, {
      action: "payment.account_binding_missing",
      entity: "payment",
      entityId: payment.id,
      actorLabel: `webhook:${input.provider}`,
      after: { providerEvent: event.eventId, warning: "sem identificador de conta no evento e nas credenciais — vinculação não verificável" },
    });
  }

  // Valor: divergência entre webhook e cobrança local NUNCA aprova.
  // Se o webhook não trouxe valor, confirma com o gateway antes de aprovar.
  let effectiveAmount: number | null | undefined = event.amountCents;
  if (effectiveAmount == null && payment.providerTransactionId) {
    const adapter = getAdapter(input.provider);
    if (adapter?.queryPayment) {
      try {
        const remote = await adapter.queryPayment(payment.providerTransactionId);
        effectiveAmount = remote.amountCents ?? null;
        // Moeda da consulta também valida.
        if (remote.currency && remote.currency.toUpperCase() !== "BRL") {
          return { ok: false, reason: "currency_mismatch", detail: { currency: remote.currency, source: "query" } };
        }
      } catch {
        return { ok: false, reason: "gateway_query_unavailable", detail: { provider: input.provider } };
      }
    }
  }
  if (effectiveAmount != null && effectiveAmount !== payment.amountCents) {
    return { ok: false, reason: "amount_mismatch", detail: { event: effectiveAmount, charged: payment.amountCents } };
  }

  return { ok: true };
}

/** Reconcilia o pagamento, transiciona o pedido e marca o evento — UMA transação. */
export async function applyPaymentEvent(
  db: Db,
  input: {
    provider: string;
    event: NormalizedWebhookEvent;
    payment: typeof schema.payments.$inferSelect;
    actorLabel?: string;
    /** id da linha em payment_events — marcada como processada NA transação. */
    eventRowId?: string;
  },
): Promise<ApplyEventResult> {
  const { event, payment } = input;
  const actorLabel = input.actorLabel ?? `webhook:${input.provider}`;

  // Chargebacks são tratados pela rota (tabela própria, transação própria).
  if (event.type === "chargeback.received" || event.type === "chargeback.resolved") {
    return { applied: false, reason: "chargeback_handled_elsewhere" };
  }

  // ---- Validação financeira ANTES de qualquer escrita.
  const validation = await validateFinancialEvent(db, input);
  if (!validation.ok) {
    // Evento fica PENDENTE (processed_at NULL) — divergência financeira é
    // investigação humana; reaplicável quando o dado for corrigido.
    await audit(db, {
      action: "payment.event_rejected",
      entity: "payment",
      entityId: payment.id,
      actorLabel,
      after: { reason: validation.reason, detail: validation.detail, providerEvent: event.eventId },
    });
    return { applied: false, reason: validation.reason };
  }

  const targetPaymentStatus = targetPaymentStatusFor(event.type);

  // ---- Transação única: pagamento + pedido + histórico + estoque + evento.
  const pendingAudits: AuditPending[] = [];
  const result = await db.transaction(async (tx) => {
    // Estado FRESCO sob lock — o `payment` de entrada pode estar obsoleto.
    const payRows = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id))
      .for("update");
    const fresh = payRows[0];
    if (!fresh) {
      return { applied: false, reason: "payment_not_found" } as ApplyEventResult;
    }

    // Proteção de regressão: estados financeiros definitivos não regridem.
    if (
      (fresh.status === "aprovado" || fresh.status === "estornado") &&
      (targetPaymentStatus === "recusado" || targetPaymentStatus === "expirado")
    ) {
      pendingAudits.push({
        action: "payment.regression_ignored",
        entity: "payment",
        entityId: fresh.id,
        actorLabel,
        after: { providerEvent: event.eventId, current: fresh.status, attempted: targetPaymentStatus },
      });
      // Evento CONSISTENTE com estado atual (já aprovado) é marcado como
      // processado — reentrega não pode reprocessar eternamente.
      if (input.eventRowId) {
        await tx
          .update(schema.paymentEvents)
          .set({ paymentId: fresh.id, processedAt: new Date() })
          .where(eq(schema.paymentEvents.id, input.eventRowId));
      }
      return { applied: false, reason: "payment_regression_ignored", paymentStatus: fresh.status } as ApplyEventResult;
    }

    // Idempotência financeira: já no estado alvo.
    if (fresh.status === targetPaymentStatus && event.type !== "payment.refunded") {
      if (input.eventRowId) {
        await tx
          .update(schema.paymentEvents)
          .set({ paymentId: fresh.id, processedAt: new Date() })
          .where(eq(schema.paymentEvents.id, input.eventRowId));
      }
      return { applied: false, reason: "already_applied", paymentStatus: fresh.status } as ApplyEventResult;
    }

    // 1) Pagamento.
    const patch: Record<string, unknown> = { status: targetPaymentStatus };
    if (targetPaymentStatus === "aprovado") patch.capturedAt = new Date();
    await tx.update(schema.payments).set(patch).where(eq(schema.payments.id, fresh.id));

    // 2) Pedido — mesmo lock, mesmo tx.
    const orderRows = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, fresh.orderId))
      .for("update");
    const order = orderRows[0];
    if (!order) {
      // Sem pedido, o pagamento atualiza mas o evento é marcado — nada mais
      // a derivar; divergência estrutural vai para auditoria.
      pendingAudits.push({
        action: "payment.order_missing",
        entity: "payment",
        entityId: fresh.id,
        actorLabel,
        after: { providerEvent: event.eventId },
      });
      if (input.eventRowId) {
        await tx
          .update(schema.paymentEvents)
          .set({ paymentId: fresh.id, processedAt: new Date() })
          .where(eq(schema.paymentEvents.id, input.eventRowId));
      }
      return { applied: true, reason: "order_not_found", paymentStatus: targetPaymentStatus } as ApplyEventResult;
    }
    const from = order.status as OrderStatus;

    // 3) Pagamento tardio: cancelado + dinheiro entrou. Estado NÃO reabre.
    if (from === "cancelado" && targetPaymentStatus === "aprovado") {
      pendingAudits.push({
        action: "order.late_payment",
        entity: "order",
        entityId: order.id,
        actorLabel,
        after: {
          paymentId: fresh.id,
          providerTransactionId: fresh.providerTransactionId,
          amountCents: fresh.amountCents,
          decision: "refund_required",
        },
      });
      if (input.eventRowId) {
        await tx
          .update(schema.paymentEvents)
          .set({ paymentId: fresh.id, processedAt: new Date() })
          .where(eq(schema.paymentEvents.id, input.eventRowId));
      }
      return { applied: true, paymentStatus: "aprovado", latePayment: true } as ApplyEventResult;
    }

    // 4) Pedido em revisão/antifraude: pagamento vira realidade financeira;
    //    a aprovação do pedido continua decisão humana.
    if (
      targetPaymentStatus === "aprovado" &&
      (from === "em_analise_antifraude" || from === "aguardando_revisao_manual")
    ) {
      if (input.eventRowId) {
        await tx
          .update(schema.paymentEvents)
          .set({ paymentId: fresh.id, processedAt: new Date() })
          .where(eq(schema.paymentEvents.id, input.eventRowId));
      }
      return { applied: true, paymentStatus: "aprovado", reason: "awaiting_human_review" } as ApplyEventResult;
    }

    // 5) Resultado financeiro decide a transição do pedido:
    //    aprovado + aguardando/processamento → pagamento_aprovado
    //    recusado/expirado + aguardando/processamento → cancelado (estoque livre)
    //    estornado + pagável → reembolsado
    const targetOrderStatus: OrderStatus | null =
      targetPaymentStatus === "aprovado"
        ? from === "aguardando_pagamento" || from === "pagamento_em_processamento"
          ? "pagamento_aprovado"
          : null
        : targetPaymentStatus === "estornado"
          ? "reembolsado"
          : from === "aguardando_pagamento" || from === "pagamento_em_processamento"
            ? "cancelado"
            : null;

    if (targetOrderStatus && from !== targetOrderStatus) {
      const outcome = await transitionOrderInTx(tx, {
        orderId: order.id,
        to: targetOrderStatus,
        reason: `Resultado financeiro ${input.provider}: ${event.type}`,
        actorLabel,
      });
      if (!outcome.transitioned) {
        // Corrida: outro concorrente já levou ao status alvo entre o FOR
        // UPDATE do pagamento e este — recua; a reentrega reavalia.
        return { applied: false, reason: "transition_noop", paymentStatus: targetPaymentStatus } as ApplyEventResult;
      }
      // 6) Evento marcado como processado NA MESMA transação — crash aqui
      //    desfaz pagamento, pedido, histórico, estoque e a marcação juntos.
      if (input.eventRowId) {
        await tx
          .update(schema.paymentEvents)
          .set({ paymentId: fresh.id, processedAt: new Date() })
          .where(eq(schema.paymentEvents.id, input.eventRowId));
      }
      return {
        applied: true,
        paymentStatus: targetPaymentStatus,
        orderTransitioned: { from, to: targetOrderStatus },
      } as ApplyEventResult;
    }

    if (input.eventRowId) {
      await tx
        .update(schema.paymentEvents)
        .set({ paymentId: fresh.id, processedAt: new Date() })
        .where(eq(schema.paymentEvents.id, input.eventRowId));
    }
    return { applied: true, paymentStatus: targetPaymentStatus } as ApplyEventResult;
  });

  // Auditoria FORA da transação — append-only, não participa do lock. Se o
  // processo morrer aqui, o estado está correto e falta só o registro.
  for (const entry of pendingAudits) {
    await audit(db, {
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      actorLabel: entry.actorLabel ?? undefined,
      after: entry.after,
    });
  }

  return result;
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

    last = await applyPaymentEvent(db, {
      provider: input.provider,
      event,
      payment: input.payment,
      eventRowId: row.id,
    });
  }
  return last;
}

/**
 * Recuperação no boot / reentrega: varre eventos não processados
 * (`processed_at IS NULL`, `dead_letter = false`) e reaplica — revisão v3
 * (ponto A da revisão):
 *
 *  - MULTI-INSTÂNCIA: cada evento é reivindicado em transação curta com
 *    `SELECT FOR UPDATE` (count do attempts + lastAttemptAt commitados).
 *    Duas instâncias podem reivindicar o MESMO evento em janela mínima — a
 *    CORREÇÃO de duplicidade vem da idempotência transacional de
 *    `applyPaymentEvent` (FOR UPDATE do pagamento + `already_applied`); o
 *    claim é eficiência, não mutex.
 *  - BACKOFF: evento com `last_attempt_at` dentro de `minBackoffMs` é
 *    pulado nesta passada (`skipped_backoff`).
 *  - LIMITE DE TENTATIVAS: `attempts >= maxAttempts` OU evento com mais de
 *    `maxAgeDays` vai para DEAD-LETTER com auditoria — evento
 *    permanentemente inválido NUNCA bloqueia a fila.
 *  - EVENTOS INVÁLIDOS: payload não-parseável ou sem `providerTransactionId`
 *    é dead-letter imediato (nunca se tornará aplicável).
 */
export async function recoverPendingEvents(
  db: Db,
  opts: { minBackoffMs?: number; maxAttempts?: number; maxAgeDays?: number; limit?: number } = {},
): Promise<{
  scanned: number;
  applied: number;
  rejected: number;
  parked: number;
  deadLettered: number;
  skippedBackoff: number;
}> {
  await initAdapters(db);

  const minBackoffMs = opts.minBackoffMs ?? 60_000;
  const maxAttempts = opts.maxAttempts ?? 30;
  const maxAgeDays = opts.maxAgeDays ?? 30;

  const pending = await db
    .select()
    .from(schema.paymentEvents)
    .where(and(isNull(schema.paymentEvents.processedAt), eq(schema.paymentEvents.deadLetter, false)))
    .orderBy(sql`${schema.paymentEvents.createdAt} asc`)
    .limit(opts.limit ?? 200);

  let applied = 0;
  let rejected = 0;
  let parked = 0;
  let deadLettered = 0;
  let skippedBackoff = 0;

  const deadLetter = async (
    row: typeof schema.paymentEvents.$inferSelect,
    reason: string,
    detail?: unknown,
  ) => {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.paymentEvents)
        .set({ deadLetter: true, processedAt: new Date(), lastError: reason })
        .where(eq(schema.paymentEvents.id, row.id));
    });
    deadLettered++;
    await audit(db, {
      action: "payment.event_dead_letter",
      entity: "payment_event",
      entityId: row.id,
      actorLabel: "recovery:boot",
      after: { provider: row.provider, eventId: row.eventId, type: row.type, reason, detail, attempts: row.attempts },
    });
  };

  for (const row of pending) {
    // ---- Backoff: tentativa recente demais, pula nesta passada.
    if (row.lastAttemptAt && Date.now() - row.lastAttemptAt.getTime() < minBackoffMs) {
      skippedBackoff++;
      continue;
    }

    // ---- Parse: invalidade permanente vai direto para dead-letter.
    let event: NormalizedWebhookEvent;
    try {
      const adapter = getAdapter(row.provider);
      if (!adapter) {
        await deadLetter(row, "unknown_provider");
        continue;
      }
      event = adapter.parseWebhook(JSON.stringify(row.payload));
    } catch (e) {
      await deadLetter(row, "invalid_payload", e instanceof Error ? e.message : String(e));
      continue;
    }
    if (!event.providerTransactionId) {
      await deadLetter(row, "missing_transaction_reference");
      continue;
    }

    // ---- Claim (eficiência multi-instância): attempts+1 commitado antes
    // da aplicação. Correção contra dupla-aplicação é da applyPaymentEvent.
    await db
      .update(schema.paymentEvents)
      .set({ attempts: row.attempts + 1, lastAttemptAt: new Date() })
      .where(eq(schema.paymentEvents.id, row.id));

    const rows = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.provider, row.provider),
          eq(schema.payments.providerTransactionId, event.providerTransactionId),
        ),
      )
      .limit(1);
    const payment = rows[0];
    if (!payment) {
      // Parked (corrida checkout×webhook) — até o limite de tentativas/idade.
      const fresh = (await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, row.id)))[0];
      const tooOld = Date.now() - row.createdAt.getTime() > maxAgeDays * 24 * 60 * 60 * 1000;
      if (tooOld || (fresh?.attempts ?? 0) >= maxAttempts) {
        await deadLetter(row, "payment_never_arrived");
      } else {
        parked++;
      }
      continue;
    }

    const outcome = await applyPaymentEvent(db, {
      provider: row.provider,
      event,
      payment,
      actorLabel: "recovery:boot",
      eventRowId: row.id,
    });
    if (outcome.applied) {
      applied++;
    } else if (
      outcome.reason &&
      ["amount_mismatch", "currency_mismatch", "account_mismatch", "account_unverified", "transaction_mismatch", "gateway_query_unavailable"].includes(outcome.reason)
    ) {
      rejected++;
      // Divergência financeira exige investigação humana: com o limite de
      // tentativas estourado, sai da fila por dead-letter (auditoria retém
      // o motivo) — nunca reprocessa indefinidamente.
      if ((row.attempts + 1) >= maxAttempts) {
        await deadLetter(row, `max_attempts_${outcome.reason}`);
      }
    } else {
      // already_applied / noop: evento saiu da fila (marcado na transação).
      applied++;
    }
  }

  return { scanned: pending.length, applied, rejected, parked, deadLettered, skippedBackoff };
}

/**
 * Reparo de falhas parciais LEGADAS (v1 pré-transação ou crash entre
 * updates): pagamento já atualizado mas pedido não. Roda no boot, depois de
 * recoverPendingEvents — revisão v3 (ponto B):
 *
 *  - IDEMPOTENTE por construção: a divergência é definida pela JUNÇÃO
 *    (payment definitivo × order em PAYMENT_PENDING_STATUSES). O primeiro
 *    reparo tira o pedido da condição — passadas seguintes não encontram
 *    nada. Duas instâncias em paralelo serializam no `FOR UPDATE` do
 *    `transitionOrderInTx`; a segunda vê `transitioned=false` e não audita.
 *  - ESTOQUE nunca é liberado duas vezes: reparo para `cancelado` passa
 *    uma única vez pelo caminho de release (pedido sai do conjunto
 *    divergente no mesmo commit).
 *  - AUDITORIA distingue correção automática de intervenção operacional:
 *    ação `payment.partial_repair`, actorLabel `recovery:boot`, payload
 *    marcado com `automatic: true` (intervenção humana usa `order.transition`
 *    com actorLabel de usuário).
 */
export async function repairPartialApplications(db: Db): Promise<{ repaired: number }> {
  const divergent = await db
    .select({ payment: schema.payments, order: schema.orders })
    .from(schema.payments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.payments.orderId))
    .where(
      and(
        inArray(schema.payments.status, ["aprovado", "recusado", "expirado", "estornado"]),
        inArray(schema.orders.status, PAYMENT_PENDING_STATUSES as unknown as string[]),
      ),
    );

  let repaired = 0;
  for (const { payment, order } of divergent) {
    const from = order.status as OrderStatus;
    const to: OrderStatus | null =
      payment.status === "aprovado"
        ? "pagamento_aprovado"
        : payment.status === "estornado"
          ? "reembolsado"
          : "cancelado";
    try {
      let done = false;
      await db.transaction(async (tx) => {
        const outcome = await transitionOrderInTx(tx, {
          orderId: order.id,
          to,
          reason: `Reparo de falha parcial: pagamento ${payment.status} com pedido ${from}`,
          actorLabel: "recovery:boot",
        });
        done = outcome.transitioned;
      });
      if (done) {
        repaired++;
        await audit(db, {
          action: "payment.partial_repair",
          entity: "order",
          entityId: order.id,
          actorLabel: "recovery:boot",
          after: {
            automatic: true,
            kind: "partial_repair",
            paymentId: payment.id,
            paymentStatus: payment.status,
            from,
            to,
            trigger: "boot",
          },
        });
      }
    } catch {
      // Transição inválida no estado atual (ex.: revisão manual) — deixa
      // para o fluxo humano; a divergência permanece auditável via query.
    }
  }
  return { repaired };
}
