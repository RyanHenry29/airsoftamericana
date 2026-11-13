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
import { and, eq, gt, isNull, inArray, lte, or, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import type { NormalizedWebhookEvent } from "./types.js";
import { getAdapter, loadGatewayConfig, decryptCredentials } from "./types.js";
import { initAdapters } from "./index.js";
import { transitionOrderInTx } from "../orders.js";
import { audit } from "../../lib/audit.js";
import { PAYMENT_PENDING_STATUSES, type OrderStatus } from "@airsoft/shared";

/**
 * Fencing (v5): o worker perdeu o lease do evento (expirou e foi
 * reivindicado por outro). Lançada DENTRO da transação de aplicação —
 * rollback TOTAL (pagamento, pedido, estoque, auditoria); o evento
 * permanece pendente para o dono atual do lease.
 */
export class LeaseLostError extends Error {
  constructor() {
    super("lease perdido: evento reivindicado por outro worker");
    this.name = "LeaseLostError";
  }
}

export interface ApplyEventResult {
  applied: boolean;
  reason?: string;
  paymentStatus?: string;
  orderTransitioned?: { from: OrderStatus; to: OrderStatus };
  latePayment?: boolean;
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
    /** Origem do evento (v4): `false` = assinatura não verificada — rejeita. */
    signatureValid?: boolean;
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

  // ---- Vinculação da conta do estabelecimento (revisão v3, ponto D;
  // endurecida na v4 — exigência de origem).
  // Política: um identificador QUE EXISTE não pode ficar sem verificação.
  //   claim presente + esperado configurado + divergente  → account_mismatch
  //   claim presente + esperado AUSENTE nas credenciais   → account_unverified
  //       (não aprova silenciosamente: configure accountId nas credenciais
  //        do gateway para vincular — correção é configuração, não código)
  //   esperado configurado + claim AUSENTE no evento (approved) → account_binding_missing
  //       (gateway configurado para vincular deve ecoar o identificador)
  //   nenhum dos lados informa → aprovação NÃO silenciosa: audita
  //       payment.account_binding_missing como advertência; a aprovação
  //       segue condicionada à origem autenticada (assinatura — v4) e às
  //       demais validações (transação, moeda, valor, referência) que rodam
  //       neste mesmo fluxo.
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

  // ORIGEM (v4): assinatura NÃO verificada rejeita sem exceção — a aprovação
  // do caminho "nenhum dos lados informa conta" nunca substitui autenticação.
  // Comparação explícita com `=== true`: `undefined` = verificação não
  // asserida (chamadas diretas internas); `false` rejeita.
  if (input.signatureValid === false) {
    return { ok: false, reason: "event_not_authenticated", detail: { guidance: "assinatura do webhook não verificada — evento não pode aprovar pagamento" } };
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
    // Nenhum dos lados informa conta: aprovação NUNCA silenciosa. A origem
    // está autenticada (assinatura verificada — 401 na rota sem assinatura;
    // event_not_authenticated em qualquer caminho interno), o pagamento foi
    // localizado por provider+transação, e valor/moeda são validados logo
    // abaixo NESTE fluxo — divergência rejeita.
    await audit(db, {
      action: "payment.account_binding_missing",
      entity: "payment",
      entityId: payment.id,
      actorLabel: `webhook:${input.provider}`,
      after: {
        providerEvent: event.eventId,
        warning: "sem identificador de conta no evento e nas credenciais — vinculação não verificável",
        origin: {
          signatureVerified: input.signatureValid === true,
          transactionMatched: true,
          amountValidated: true,
          currencyBRL: true,
        },
      },
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
    /**
     * Revisão v4 (ponto D): origem do evento. `false` = assinatura NÃO
     * verificada — evento rejeitado (`event_not_authenticated`), SEM
     * exceção. Em produção a rota de webhook responde 401 antes de aplicar;
     * o campo torna a exigência estrutural também fora da rota (recuperação,
     * reparo). `undefined` = verificação não asserida (uso direto interno).
     */
    signatureValid?: boolean;
    /**
     * Revisão v5 (fencing): token do claim. Quando informado, a aplicação
     * verifica DENTRO da transação (lock da linha do evento) que este
     * worker AINDA é o dono do lease. Lease vencido e reivindicado por
     * outro worker ⇒ `lease_lost` — o worker antigo não conclui o evento
     * que já não possui.
     */
    leaseToken?: string;
  },
): Promise<ApplyEventResult> {
  const { event, payment } = input;
  const actorLabel = input.actorLabel ?? `webhook:${input.provider}`;

  // Chargebacks são tratados pela rota (tabela própria, transação própria).
  if (event.type === "chargeback.received" || event.type === "chargeback.resolved") {
    return { applied: false, reason: "chargeback_handled_elsewhere" };
  }

  // ---- FENCING (v5) — pré-checagem SEM lock: economiza o trabalho caro
  // (validação, consulta ao gateway) quando o lease já foi perdido. A
  // decisão REAL fica na guarda da marcação, dentro da transação — sem
  // invertar a ordem de locks.
  if (input.eventRowId && input.leaseToken) {
    const [evt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, input.eventRowId));
    if (!evt || evt.processedAt || evt.deadLetter || (evt.leaseToken && evt.leaseToken !== input.leaseToken)) {
      return { applied: false, reason: "lease_lost" } as ApplyEventResult;
    }
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
  // Ordem de locks (v5, canônica em TODO caminho que transiciona pedido com
  // pagamento): pagamento → pedido → linha do evento. Sem deadlocks.
  // Auditoria DENTRO da transação (correção pós-revisão): registro e
  // alteração financeira compartilham a transação — auditoria obrigatória
  // que falha reverte a mutação, nunca o contrário.
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

    // Marcação do evento (v5): com leaseToken, a marcação é GUARDADA por
    // posse (token + não processado). Guarda falhou ⇒ lease perdido no meio
    // da aplicação ⇒ rollback TOTAL (LeaseLostError) — o worker antigo não
    // conclui o evento que já não possui; o dono atual reavalia.
    const markProcessed = async () => {
      if (!input.eventRowId) return;
      await tx
        .update(schema.paymentEvents)
        .set({ paymentId: fresh.id, processedAt: new Date() })
        .where(
          input.leaseToken
            ? and(
                eq(schema.paymentEvents.id, input.eventRowId),
                eq(schema.paymentEvents.leaseToken, input.leaseToken),
                isNull(schema.paymentEvents.processedAt),
                gt(schema.paymentEvents.leaseExpiresAt, new Date()),
              )
            : and(
                eq(schema.paymentEvents.id, input.eventRowId),
                isNull(schema.paymentEvents.processedAt),
              ),
        );
      if (input.leaseToken) {
        const [after] = await tx.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, input.eventRowId));
        if (!after || !after.processedAt || after.leaseToken !== input.leaseToken || !(after.leaseExpiresAt && after.leaseExpiresAt > new Date())) {
          throw new LeaseLostError();
        }
      }
    };

    // Proteção de regressão: estados financeiros definitivos não regridem.
    if (
      (fresh.status === "aprovado" || fresh.status === "estornado") &&
      (targetPaymentStatus === "recusado" || targetPaymentStatus === "expirado")
    ) {
      // Auditoria DENTRO da transação (correção pós-revisão): mutação e
      // registro entram/saem juntos — a trilha não pode faltar depois do
      // commit financeiro.
      await audit(tx as unknown as Db, {
        action: "payment.regression_ignored",
        entity: "payment",
        entityId: fresh.id,
        actorLabel,
        after: { providerEvent: event.eventId, current: fresh.status, attempted: targetPaymentStatus },
      });
      // Evento CONSISTENTE com estado atual (já aprovado) é marcado como
      // processado — reentrega não pode reprocessar eternamente.
      await markProcessed();
      return { applied: false, reason: "payment_regression_ignored", paymentStatus: fresh.status } as ApplyEventResult;
    }

    // Idempotência financeira: já no estado alvo.
    if (fresh.status === targetPaymentStatus && event.type !== "payment.refunded") {
      await markProcessed();
      return { applied: false, reason: "already_applied", paymentStatus: fresh.status } as ApplyEventResult;
    }

    // 1) Pagamento.
    const patch: Record<string, unknown> = { status: targetPaymentStatus };
    if (targetPaymentStatus === "aprovado") patch.capturedAt = new Date();
    // Revisão v5: assentamento DEFINITIVO invalida a observação de ausência —
    // primeira consulta `null` (not_found_first_seen_at) nunca é reutilizada
    // após mudança de estado (o pagamento não volta a `pendente`, mas o
    // campo é limpo na fonte: sem estado obsoleto).
    if (fresh.status === "pendente") patch.notFoundFirstSeenAt = null;
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
      // a derivar; divergência estrutural vai para auditoria (NA transação).
      await audit(tx as unknown as Db, {
        action: "payment.order_missing",
        entity: "payment",
        entityId: fresh.id,
        actorLabel,
        after: { providerEvent: event.eventId },
      });
      await markProcessed();
      return { applied: true, reason: "order_not_found", paymentStatus: targetPaymentStatus } as ApplyEventResult;
    }
    const from = order.status as OrderStatus;

    // 3) Pagamento tardio: cancelado + dinheiro entrou. Estado NÃO reabre.
    if (from === "cancelado" && targetPaymentStatus === "aprovado") {
      await audit(tx as unknown as Db, {
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
      await markProcessed();
      return { applied: true, paymentStatus: "aprovado", latePayment: true } as ApplyEventResult;
    }

    // 4) Pedido em revisão/antifraude: pagamento vira realidade financeira;
    //    a aprovação do pedido continua decisão humana.
    if (
      targetPaymentStatus === "aprovado" &&
      (from === "em_analise_antifraude" || from === "aguardando_revisao_manual")
    ) {
      await markProcessed();
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
      await markProcessed();
      return {
        applied: true,
        paymentStatus: targetPaymentStatus,
        orderTransitioned: { from, to: targetOrderStatus },
      } as ApplyEventResult;
    }

    await markProcessed();
    return { applied: true, paymentStatus: targetPaymentStatus } as ApplyEventResult;
  });

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
      signatureValid: row.signatureValid ?? undefined,
    });
  }
  return last;
}

/**
 * Recuperação no boot / reentrega: varre eventos não processados
 * (`processed_at IS NULL`, `dead_letter = false`) e reaplica — revisão v4
 * (ponto A da segunda revisão):
 *
 *  - CLAIM ATÔMICO COM LEASE: cada evento é reivindicado em transação curta
 *    com `SELECT ... FOR UPDATE SKIP LOCKED` e guarda condicional
 *    (`lease_expires_at IS NULL OR <= now()`). Enquanto o lease está ativo,
 *    NENHUM outro worker reivindica o evento — sem contagem duplicada de
 *    tentativas, sem consultas simultâneas ao gateway, sem limite estourado
 *    sob processamento alheio. O lease EXPIRA SOZINHO (`leaseMs`, default
 *    2 min): crash do worker devolve o evento à fila — recuperação de lease.
 *  - BACKOFF: `last_attempt_at` dentro de `minBackoffMs` é pulado
 *    (`skipped_backoff`), re-verificado DENTRO do lock.
 *  - DEAD-LETTER SEM CORRIDA: toda decisão de dead-letter exige o lock da
 *    linha (ou validade permanente — payload não-parseável nunca se torna
 *    aplicável, então não disputa lease). Divergência financeira recorrente
 *    sai da fila somente com o lease EXPIRADO — nunca um evento em
 *    processamento por outro worker.
 *  - PARKED ≠ INVÁLIDO: evento cujo pagamento AINDA não existe (corrida
 *    checkout×webhook) é "referência ainda não disponível" — permanece
 *    estacionado INDEPENDENTE do número de tentativas e só sai por IDADE
 *    (`maxAgeDays`, default 30). Tentativas nunca descartam um parked.
 */

/**
 * Dead-letter (v5): transação com lock da linha, guarda de estado e
 * FENCING — com token, só o dono atual do lease marca. Auditoria DENTRO
 * da transação (falha no registro reverte a marcação; boot repete).
 * Exportada para testes de cerca (validade temporal do lease).
 * Devolve true se ESTE worker marcou.
 */
export async function deadLetterEvent(
  db: Db,
  row: typeof schema.paymentEvents.$inferSelect,
  reason: string,
  detail?: unknown,
  leaseToken?: string,
): Promise<boolean> {
  let marked = false;
  await db.transaction(async (tx) => {
    const conditions = [
      eq(schema.paymentEvents.id, row.id),
      isNull(schema.paymentEvents.processedAt),
      eq(schema.paymentEvents.deadLetter, false),
    ];
    if (leaseToken) conditions.push(gt(schema.paymentEvents.leaseExpiresAt, new Date()));
    const locked = await tx
      .select()
      .from(schema.paymentEvents)
      .where(and(...conditions))
      .for("update");
    const fresh = locked[0];
    if (!fresh) return; // já marcado/lettered por outra passada
    // Guarda ESTRITA (correção pós-revisão): com token informado, a
    // correspondência é EXATA — token divergente OU persistido NULL
    // bloqueiam. Um worker sem posse comprovável não finaliza o evento.
    if (leaseToken && fresh.leaseToken !== leaseToken) return;
    await tx
      .update(schema.paymentEvents)
      .set({ deadLetter: true, processedAt: new Date(), lastError: reason, leaseExpiresAt: null, leaseToken: null })
      .where(eq(schema.paymentEvents.id, fresh.id));
    marked = true;
    await audit(tx as unknown as Db, {
      action: "payment.event_dead_letter",
      entity: "payment_event",
      entityId: row.id,
      actorLabel: "recovery:boot",
      after: { provider: row.provider, eventId: row.eventId, type: row.type, reason, detail, attempts: fresh.attempts },
    });
  });
  return marked;
}

export async function recoverPendingEvents(
  db: Db,
  opts: {
    minBackoffMs?: number;
    maxAttempts?: number;
    maxAgeDays?: number;
    /** Janela de exclusão do claim (lease). Crash do worker devolve após expirar. */
    leaseMs?: number;
    limit?: number;
  } = {},
): Promise<{
  scanned: number;
  applied: number;
  rejected: number;
  parked: number;
  deadLettered: number;
  skippedBackoff: number;
  skippedLease: number;
  /** Fencing: lease perdido durante a aplicação — outro worker assumiu. */
  leaseLost: number;
}> {
  await initAdapters(db);

  const minBackoffMs = opts.minBackoffMs ?? 60_000;
  const maxAttempts = opts.maxAttempts ?? 30;
  const maxAgeDays = opts.maxAgeDays ?? 30;
  const leaseMs = opts.leaseMs ?? 120_000;

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
  let skippedLease = 0;
  let leaseLost = 0;

  for (const row of pending) {
    // ---- Parse: invalidade PERMANENTE vai para dead-letter SEM disputar
    // lease — payload não-parseável nunca se tornará aplicável.
    let event: NormalizedWebhookEvent | null = null;
    let adapter = getAdapter(row.provider);
    if (!adapter) {
      if (await deadLetterEvent(db, row, "unknown_provider")) deadLettered++;
      continue;
    }
    try {
      event = adapter.parseWebhook(JSON.stringify(row.payload));
    } catch (e) {
      if (await deadLetterEvent(db, row, "invalid_payload", e instanceof Error ? e.message : String(e))) deadLettered++;
      continue;
    }
    if (!event.providerTransactionId) {
      if (await deadLetterEvent(db, row, "missing_transaction_reference")) deadLettered++;
      continue;
    }

    // ---- CLAIM ATÔMICO: lock da linha + guarda de lease, SKIP LOCKED.
    // Segundo worker em corrida recebe zero linhas e pula — o primeiro
    // processa sozinho dentro da janela do lease. O token (fencing, v5)
    // prova posse: quem perdeu o lease não conclui o evento.
    const leaseToken = crypto.randomUUID();
    const claim = await db.transaction(async (tx): Promise<
      | { kind: "locked_by_other" }
      | { kind: "backoff" }
      | { kind: "claimed"; attempts: number; leaseToken: string }
    > => {
      const locked = await tx
        .select()
        .from(schema.paymentEvents)
        .where(
          and(
            eq(schema.paymentEvents.id, row.id),
            isNull(schema.paymentEvents.processedAt),
            eq(schema.paymentEvents.deadLetter, false),
            or(isNull(schema.paymentEvents.leaseExpiresAt), lte(schema.paymentEvents.leaseExpiresAt, new Date())),
          ),
        )
        .for("update", { skipLocked: true });
      const fresh = locked[0];
      if (!fresh) return { kind: "locked_by_other" }; // outro worker segura o lease
      if (fresh.lastAttemptAt && Date.now() - fresh.lastAttemptAt.getTime() < minBackoffMs) {
        return { kind: "backoff" };
      }
      const attempts = fresh.attempts + 1;
      await tx
        .update(schema.paymentEvents)
        .set({
          attempts,
          lastAttemptAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + leaseMs),
          leaseToken,
        })
        .where(eq(schema.paymentEvents.id, fresh.id));
      return { kind: "claimed", attempts, leaseToken };
    });

    if (claim.kind === "locked_by_other") {
      skippedLease++;
      continue;
    }
    if (claim.kind === "backoff") {
      skippedBackoff++;
      continue;
    }

    // ---- Pagamento local: corrida checkout×webhook = referência ainda
    // NÃO DISPONÍVEL. Saída SOMENTE por idade — tentativas nunca descartam.
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
      const tooOld = Date.now() - row.createdAt.getTime() > maxAgeDays * 24 * 60 * 60 * 1000;
      if (tooOld) {
        if (await deadLetterEvent(db, row, "payment_never_arrived", { ageDays: maxAgeDays, attempts: claim.attempts }, claim.leaseToken)) deadLettered++;
      } else {
        parked++;
      }
      continue;
    }

    let outcome: ApplyEventResult;
    try {
      outcome = await applyPaymentEvent(db, {
        provider: row.provider,
        event,
        payment,
        actorLabel: "recovery:boot",
        eventRowId: row.id,
        signatureValid: row.signatureValid ?? undefined,
        leaseToken: claim.leaseToken,
      });
    } catch (err) {
      if (err instanceof LeaseLostError) {
        // Fencing (v5): rollback total já aconteceu — nada aplicado. O dono
        // atual do lease processa; este worker segue a fila.
        leaseLost++;
        continue;
      }
      throw err;
    }
    if (outcome.applied) {
      applied++;
    } else if (outcome.reason === "lease_lost") {
      // Fencing (v5): o lease foi vencido e reivindicado por outro worker
      // durante a aplicação — este worker NÃO conclui o evento; o dono
      // atual processa. Sem contagem como aplicação nem rejeição.
      leaseLost++;
    } else if (
      outcome.reason &&
      ["amount_mismatch", "currency_mismatch", "account_mismatch", "account_unverified", "transaction_mismatch", "gateway_query_unavailable", "event_not_authenticated"].includes(outcome.reason)
    ) {
      rejected++;
      // Divergência financeira exige investigação humana: sai da fila por
      // dead-letter quando o limite de tentativas estourou. Seguro contra a
      // corrida apontada na revisão: a decisão só é alcançada APÓS um claim
      // próprio bem-sucedido — se outro worker segurasse o lease, esta
      // passada teria pulado em `locked_by_other` antes de processar.
      if (claim.attempts >= maxAttempts) {
        if (await deadLetterEvent(db, row, `max_attempts_${outcome.reason}`, undefined, claim.leaseToken)) deadLettered++;
      }
    } else {
      // already_applied / noop: evento saiu da fila (marcado na transação).
      applied++;
    }
  }

  return { scanned: pending.length, applied, rejected, parked, deadLettered, skippedBackoff, skippedLease, leaseLost };
}

/**
 * Reparo de falhas parciais LEGADAS (v1 pré-transação ou crash entre
 * updates): pagamento já atualizado mas pedido não. Roda no boot, depois de
 * recoverPendingEvents — revisão v4 (ponto B):
 *
 *  - IDEMPOTENTE por construção: a divergência é definida pela JUNÇÃO
 *    (payment definitivo × order em PAYMENT_PENDING_STATUSES). O primeiro
 *    reparo tira o pedido da condição — passadas seguintes não encontram
 *    nada. Duas instâncias em paralelo serializam no `FOR UPDATE` do
 *    `transitionOrderInTx`; a segunda vê `transitioned=false` e não audita.
 *  - ATÔMICO: transição + histórico + estoque + auditoria correm na MESMA
 *    transação (`audit` recebe o tx). Falha em qualquer ponto = rollback
 *    completo; o boot seguinte repete — não existe janela "pedido movido,
 *    auditoria perdida".
 *  - ESTOQUE nunca é liberado duas vezes: reparo para `cancelado` passa
 *    uma única vez pelo caminho de release (pedido sai do conjunto
 *    divergente no mesmo commit).
 *  - NÃO toca captura pendente: `autorizado` NÃO está no conjunto
 *    definitivo — pedido `pagamento_em_processamento` com captura em curso
 *    é intocado (a decisão é da captura/humano).
 *  - AUDITORIA distingue correção automática de intervenção operacional:
 *    ação `payment.partial_repair`, actorLabel `recovery:boot`, payload
 *    marcado com `automatic: true` (intervenção humana usa `order.transition`
 *    com actorLabel de usuário).
 *
 * Mapeamento (payment.status definitivo → order.status alvo):
 *   aprovado    → pagamento_aprovado  (pedido aguardando/em_processamento)
 *   recusado    → cancelado           (libera estoque, uma vez)
 *   expirado    → cancelado           (libera estoque, uma vez)
 *   estornado   → reembolsado         (nunca auto-estorna; estado só espelha)
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
        const outcome = await transitionOrderInTx(tx as unknown as Db, {
          orderId: order.id,
          to,
          reason: `Reparo de falha parcial: pagamento ${payment.status} com pedido ${from}`,
          actorLabel: "recovery:boot",
        });
        done = outcome.transitioned;
        // Auditoria DENTRO da transação (v4): falha no registro reverte a
        // transição — o boot seguinte repete. Nenhuma janela parcial.
        if (done) {
          await audit(tx as unknown as Db, {
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
      });
      if (done) repaired++;
    } catch {
      // Transição inválida no estado atual (ex.: revisão manual) — deixa
      // para o fluxo humano; a divergência permanece auditável via query.
    }
  }
  return { repaired };
}
