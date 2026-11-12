// language: TS, file: apps/api/src/services/checkout.ts, target: Fastify 5 + drizzle
import { eq, sql, and, gte, lt, count } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../lib/errors.js";
import { checkOrderVolume, nextOrderNumber, transitionOrder } from "./orders.js";
import { reserveStock } from "./inventory.js";
import { assessRisk, saveAssessment } from "./fraud.js";
import { validateCoupon, incrementCouponUsage } from "./coupons.js";
import { calculateShipping, getCheapestOption, type ShippingOption } from "./shipping.js";
import { getFreeShippingFromCents } from "./settings.js";
import { resolveActiveAdapter, loadGatewayConfig, isSandboxProvider, type QueryPaymentResult } from "./payments/types.js";
import { initAdapters } from "./payments/index.js";
import { applyPendingEventsForPayment } from "./payments/webhook-events.js";
import { sha256, CredentialDecryptionError } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import type { CheckoutInput, OrderStatus, PaymentMethod, PaymentStatus } from "@airsoft/shared";

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  payment: {
    method: PaymentMethod;
    provider: string;
    status: PaymentStatus;
    payload?: string;
    expiresAt?: Date;
    providerTransactionId: string;
  };
}

const checkoutCache = new Map<string, { orderId: string; expiresAt: number }>();

/** Reproduz a resposta de um checkout já processado (idempotência). */
async function replayCheckout(
  db: Db,
  orderId: string,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  const order = rows[0];
  if (!order) throw conflict("checkout_replay_missing", "Pedido de idempotência não encontrado");
  const payRows = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
  const payment = payRows[0];
  return {
    orderId: order.id,
    orderNumber: order.number,
    status: order.status as OrderStatus,
    payment: payment
      ? {
          method: payment.method as PaymentMethod,
          provider: payment.provider,
          status: (payment.status === "aprovado"
            ? "aprovado"
            : payment.status === "recusado"
              ? "recusado"
              : payment.status === "autorizado"
                ? "autorizado"
                : "pendente") as PaymentStatus,
          payload: payment.payload ?? undefined,
          expiresAt: payment.expiresAt ?? undefined,
          providerTransactionId: payment.providerTransactionId ?? "",
        }
      : {
          method: input.paymentMethod as PaymentMethod,
          provider: "",
          status: "pendente" as PaymentStatus,
          providerTransactionId: "",
        },
  };
}

export async function handleCheckout(
  db: Db,
  input: CheckoutInput & { deviceFingerprint?: string; cardToken?: string; installments?: number },
  context: {
    customerId: string;
    ip?: string;
    correlationId?: string;
    /** Header Idempotency-Key da requisição (opcional; o fingerprint cobre retry). */
    idempotencyKey?: string;
  },
): Promise<CheckoutResult> {
  // ---- Hash semântico do payload: TUDO que muda o significado financeiro
  // do pedido (ponto 3 da revisão): itens, método, endereço, cupom, serviço
  // de frete, parcelamento, notas. Sem componente temporal — é o payloadHash
  // comparado em toda reutilização de Idempotency-Key.
  const semanticHash = sha256(
    JSON.stringify({
      c: context.customerId,
      i: input.items,
      t: input.paymentMethod,
      a: input.address,
      cp: input.couponCode ?? null,
      sh: input.shippingService ?? null,
      ins: input.installments ?? null,
      n: input.customerNotes ?? null,
    }),
  );
  // Chave automática (sem header): fingerprint + janela de 5 min — retry
  // imediato deduplica; compra legítima do mesmo carrinho depois é NOVA.
  const fingerprint = sha256(semanticHash + Math.floor(Date.now() / (5 * 60 * 1000)));

  // ---- Idempotência do POST de checkout (AUD-15 / regra dura nº 4):
  // chave = header Idempotency-Key ou fingerprint. Persistida em
  // idempotency_keys com unique — dois checkouts idênticos concorrentes
  // resolvem para UM pedido, mesmo em múltiplas instâncias e após
  // reinicialização (o estado vive no banco, não em memória).
  const idemKey = `checkout:${context.customerId}:${context.idempotencyKey ?? fingerprint}`;
  const [existingIdem] = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(eq(schema.idempotencyKeys.key, idemKey))
    .limit(1);
  if (existingIdem) {
    // Hash-compare em TODA reutilização: mesma chave + payload diferente = 409.
    if (existingIdem.payloadHash && existingIdem.payloadHash !== semanticHash) {
      throw conflict(
        "idempotency_key_reuse",
        "Idempotency-Key já utilizada com outro carrinho/payload.",
      );
    }
    if (existingIdem.result && typeof (existingIdem.result as { orderId?: string })?.orderId === "string") {
      return replayCheckout(db, (existingIdem.result as { orderId: string }).orderId, input);
    }
  }
  const cached = checkoutCache.get(fingerprint);
  if (cached && cached.expiresAt > Date.now()) {
    return replayCheckout(db, cached.orderId, input);
  }

  // ---- Gateway ANTES de qualquer escrita (AUD-01): sem gateway válido o
  // checkout responde 503 e NÃO cria pedido, NÃO reserva estoque.
  await initAdapters(db);
  let adapter;
  try {
    adapter = await resolveActiveAdapter(db);
  } catch (error) {
    // Credencial ilegível é indisponibilidade, não falta de configuração.
    // O detalhe técnico fica na auditoria; o cliente vê a orientação.
    if (error instanceof CredentialDecryptionError) {
      throw serviceUnavailable(
        "gateway_unavailable",
        "Gateway indisponível no momento — tente novamente em instantes ou escolha outra forma de pagamento.",
      );
    }
    throw error;
  }
  if (!adapter || (process.env.NODE_ENV === "production" && isSandboxProvider(adapter.provider))) {
    throw serviceUnavailable(
      "no_payment_gateway_enabled",
      "Nenhum gateway de pagamento está habilitado — o checkout está temporariamente indisponível.",
    );
  }

  const variantIds = input.items.map((i) => i.variantId);
  const variants = await db.select().from(schema.productVariants).where(sql`${schema.productVariants.id} IN (${sql.join(variantIds.map((id) => sql`${id}`), sql`, `)})`);
  if (variants.length !== variantIds.length) throw notFound("Uma ou mais variantes não existem");

  const products = await db.select().from(schema.products).where(sql`${schema.products.id} IN (${sql.join([...new Set(variants.map((v) => v.productId))].map((id) => sql`${id}`), sql`, `)})`);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const categoryIds = [...new Set(products.map((p) => p.categoryId).filter(Boolean))] as string[];
  const categories = categoryIds.length
    ? await db.select().from(schema.categories).where(sql`${schema.categories.id} IN (${sql.join(categoryIds.map((id) => sql`${id}`), sql`, `)})`)
    : [];
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  let subtotalCents = 0;
  let totalWeightGrams = 0;
  let requiresAgeGate = false;
  const snapshots: { variantId: string; sku: string; name: string; unitPriceCents: number; quantity: number }[] = [];

  for (const item of input.items) {
    const variant = variants.find((v) => v.id === item.variantId)!;
    const product = productMap.get(variant.productId)!;
    if (!product || !product.published) throw badRequest("product_unavailable", `Produto indisponível: ${product?.name ?? variant.name}`);
    if (!variant.active) throw badRequest("variant_inactive", `Variação indisponível: ${variant.name}`);
    if (product.ageRestricted || categoryMap.get(product.categoryId)?.ageRestricted) {
      requiresAgeGate = true;
    }
    const unitPriceCents = variant.promoPriceCents != null ? variant.promoPriceCents : variant.priceCents;
    subtotalCents += unitPriceCents * item.quantity;
    totalWeightGrams += variant.weightGrams * item.quantity;
    snapshots.push({ variantId: variant.id, sku: variant.sku, name: variant.name, unitPriceCents, quantity: item.quantity });

    const availRows = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    const avail = availRows[0] ? availRows[0].physical - availRows[0].reserved : 0;
    if (avail < item.quantity) {
      throw conflict("insufficient_stock", `Estoque insuficiente para ${variant.name}`, { available: avail, requested: item.quantity });
    }
  }

  let discountCents = 0;
  let couponId: string | undefined;
  if (input.couponCode) {
    const validation = await validateCoupon(db, { code: input.couponCode, subtotalCents });
    if (!validation.valid) throw badRequest("invalid_coupon", validation.message ?? "Cupom inválido");
    if (validation.kind === "frete") {
      discountCents = 0;
    } else {
      discountCents = validation.discountCents;
    }
    couponId = validation.couponId;
  }

  // Frete grátis: o limite vem do settings (banco), nunca do ambiente.
  const freeShippingFromCents = await getFreeShippingFromCents(db);
  const shippingOptions = calculateShipping({
    zip: input.address.zip,
    subtotalCents,
    totalWeightGrams,
    freeShippingFromCents,
  });
  const shippingOption =
    shippingOptions.find((o) => o.service === input.shippingService) ??
    getCheapestOption(shippingOptions);
  let shippingCents = shippingOption.priceCents;
  if (input.couponCode) {
    const validation = await validateCoupon(db, { code: input.couponCode, subtotalCents });
    if (validation.valid && validation.kind === "frete") shippingCents = 0;
  }

  let amountCents = subtotalCents - discountCents + shippingCents;
  if (input.paymentMethod === "pix") {
    const cfg = await loadGatewayConfig(db, adapter.provider);
    const pct = cfg?.pixDiscountPercent ?? 0;
    if (pct > 0) {
      const pixDiscount = Math.floor((subtotalCents * pct) / 100);
      amountCents = subtotalCents - discountCents - pixDiscount + shippingCents;
    }
  }
  if (amountCents < 0) amountCents = 0;

  const volumeCheck = await checkOrderVolume(db, { customerId: context.customerId, totalCents: amountCents });
  if (!volumeCheck.allowed) {
    throw conflict("volume_exceeded", volumeCheck.reason ?? "Cota diária de pedidos excedida");
  }
  const requiresReview = volumeCheck.requiresReview;

  const orderId = crypto.randomUUID();
  const orderNumber = await nextOrderNumber(db);
  const day = new Date().toISOString().slice(0, 10);

  const customerRows = await db.select().from(schema.customers).where(eq(schema.customers.id, context.customerId));
  const customer = customerRows[0];
  if (!customer) throw notFound("Cliente não encontrado");

  if (requiresAgeGate) {
    const ageConfirmed = (input as { ageConfirmed?: boolean }).ageConfirmed === true;
    let isAdult = false;
    if (customer.ageVerifiedAt) {
      isAdult = true;
    } else if (customer.bornAt) {
      const born = new Date(customer.bornAt);
      const now = new Date();
      let age = now.getFullYear() - born.getFullYear();
      const m = now.getMonth() - born.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
      isAdult = age >= 18;
    }
    if (!isAdult || !ageConfirmed) {
      throw badRequest(
        "age_verification_required",
        "Este pedido contém itens com restrição 18+. Confirme que você tem 18 anos ou mais para continuar.",
      );
    }
  }

  // ---- Pedido + itens + reserva + chave de idempotência em UMA transação.
  // A chave com unique serializa checkouts idênticos concorrentes: quem
  // perder a corrida lê o orderId vencedor e reproduz a resposta.
  class CheckoutReplay extends Error {
    constructor() {
      super("checkout_replay");
    }
  }
  try {
    await db.transaction(async (tx) => {
      try {
        // result gravado na INSERÇÃO: perdedores da corrida (unique violation)
        // leem o orderId imediatamente — sem janela de null.
        await tx.insert(schema.idempotencyKeys).values({
          id: crypto.randomUUID(),
          key: idemKey,
          action: "checkout",
          payloadHash: semanticHash,
          result: { orderId },
        });
      } catch (e) {
        // drizzle embrulha: "Failed query: ..." com a causa original em .cause
        const chain: string[] = [];
        let cur: unknown = e;
        while (cur instanceof Error) {
          chain.push(cur.message);
          cur = (cur as { cause?: unknown }).cause;
        }
        if (chain.some((m) => /unique|duplicate/i.test(m))) throw new CheckoutReplay();
        throw e;
      }

      await tx.insert(schema.orders).values({
        id: orderId,
        number: orderNumber,
        customerId: context.customerId,
        // AUD-15: o pedido NASCE aguardando_pagamento e SAI dele apenas pelo
        // resultado financeiro do provedor (ou decisão humana). A criação da
        // cobrança não é resultado.
        status: "aguardando_pagamento",
        subtotalCents,
        discountCents,
        shippingCents,
        totalCents: amountCents,
        couponCode: input.couponCode ?? null,
        paymentMethod: input.paymentMethod,
        addressJson: input.address as never,
        customerNotes: input.customerNotes ?? null,
        termsVersion: "1.0",
        termsAcceptedAt: new Date(),
        termsIp: context.ip ?? null,
        volumeDay: day,
        riskLevel: "baixo",
        riskScore: 0,
        riskReasons: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      for (const snap of snapshots) {
        await tx.insert(schema.orderItems).values({
          id: crypto.randomUUID(),
          orderId,
          variantId: snap.variantId,
          sku: snap.sku,
          name: snap.name,
          quantity: snap.quantity,
          unitPriceCents: snap.unitPriceCents,
          totalCents: snap.unitPriceCents * snap.quantity,
        });
        await reserveStock(tx as unknown as Db, {
          variantId: snap.variantId,
          quantity: snap.quantity,
          orderId,
          reason: "Checkout iniciado",
        });
      }

      await tx.insert(schema.orderStatusHistory).values({
        id: crypto.randomUUID(),
        orderId,
        fromStatus: null,
        toStatus: "aguardando_pagamento",
        actorType: "system",
        actorSystem: true,
        createdAt: new Date(),
      });

      if (couponId) await incrementCouponUsage(tx as unknown as Db, couponId);
    });
  } catch (e) {
    if (e instanceof CheckoutReplay) {
      // Vencedor já commitou chave (com orderId) + pedido. Mesmo payload →
      // reproduz a resposta dele; payload DIFERENTE na mesma chave → 409
      // (ponto 3: reutilização de chave com payload diverso nunca herda
      // o pedido alheio, nem na corrida).
      const [winner] = await db
        .select()
        .from(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.key, idemKey))
        .limit(1);
      if (winner?.payloadHash && winner.payloadHash !== semanticHash) {
        throw conflict(
          "idempotency_key_reuse",
          "Idempotency-Key já utilizada com outro carrinho/payload.",
        );
      }
      const winnerOrderId = (winner?.result as { orderId?: string } | null)?.orderId;
      if (winnerOrderId) return replayCheckout(db, winnerOrderId, input);
      // Chave existente sem orderId: forma antiga — trata como duplicata.
      throw conflict("checkout_duplicate", "Checkout idêntico já em processamento");
    }
    throw e;
  }

  const priorOrdersLast24h = (
    await db
      .select({ n: count() })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerId, context.customerId),
          gte(schema.orders.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ),
      )
  )[0]?.n ?? 0;

  const failedAttemptsLast24h = (
    await db
      .select({ n: count() })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.orderId, schema.orders.id))
      .where(
        and(
          eq(schema.orders.customerId, context.customerId),
          eq(schema.payments.status, "recusado"),
          gte(schema.payments.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ),
      )
  )[0]?.n ?? 0;

  const customerAddresses = await db.select().from(schema.customerAddresses).where(eq(schema.customerAddresses.customerId, context.customerId));
  const addressDivergent = customerAddresses.length > 0 && !customerAddresses.some((a) => a.zip === input.address.zip);

  const risk = await assessRisk(db, {
    orderId,
    customerId: context.customerId,
    customerEmail: customer.email,
    customerCpf: customer.cpf,
    totalCents: amountCents,
    ip: context.ip ?? null,
    deviceFingerprint: input.deviceFingerprint ?? null,
    priorOrdersLast24h,
    failedAttemptsLast24h,
    addressDivergent,
  });
  await saveAssessment(db, {
    orderId,
    customerId: context.customerId,
    customerEmail: customer.email,
    customerCpf: customer.cpf,
    totalCents: amountCents,
    ip: context.ip ?? null,
    priorOrdersLast24h,
    failedAttemptsLast24h,
    addressDivergent,
    ...risk,
    deviceFingerprint: input.deviceFingerprint ?? null,
  });

  // Risco reclassifica o pedido (nunca aprova): alto → antifraude;
  // médio/revisão → revisão manual; baixo → permanece aguardando_pagamento.
  let finalStatus: OrderStatus = "aguardando_pagamento";
  if (risk.level === "alto") {
    finalStatus = "em_analise_antifraude";
    await transitionOrder(db, { orderId, to: "em_analise_antifraude", reason: `Score ${risk.score}: ${risk.reasons[0]?.name ?? ""}`, actorLabel: "antifraude" });
  } else if (risk.level === "medio" || requiresReview) {
    finalStatus = "aguardando_revisao_manual";
    await transitionOrder(db, { orderId, to: "aguardando_revisao_manual", reason: `Score ${risk.score}`, actorLabel: "antifraude" });
  }

  const gatewayConfig = await loadGatewayConfig(db, adapter.provider);
  const captureAfterReview = gatewayConfig?.captureAfterReview ?? false;

  let paymentResult: CheckoutResult["payment"];

  if (risk.level === "alto") {
    // Alto risco: NEM COBRANÇA é criada no provedor até revisão humana.
    await db.insert(schema.payments).values({
      id: crypto.randomUUID(),
      orderId,
      provider: adapter.provider,
      method: input.paymentMethod,
      status: "recusado",
      amountCents,
      createdAt: new Date(),
    });
    paymentResult = {
      method: input.paymentMethod,
      provider: adapter.provider,
      status: "recusado",
      providerTransactionId: "",
    };
  } else {
    let created;
    try {
      created = await adapter.createPayment({
        orderId,
        amountCents,
        method: input.paymentMethod,
        customer: { name: customer.name, email: customer.email, cpf: customer.cpf, phone: customer.phone },
        cardToken: input.cardToken,
        installments: input.installments,
      });
    } catch (error) {
      // ---- Timeout/falha ambígua (ponto 5 da revisão): a comunicação
      // falhou, mas a cobrança PODE ter sido criada no provedor. NUNCA
      // cancela sem verificar — cancelar com cobrança viva = pedido morto
      // com dinheiro em trânsito.
      let remote: QueryPaymentResult | null | undefined;
      try {
        remote = adapter.queryPaymentByOrder ? await adapter.queryPaymentByOrder(orderId) : undefined;
      } catch {
        remote = undefined; // consulta também falhou → desconhecido
      }

      if (remote) {
        // A cobrança EXISTE: adota o estado real informado pelo provedor.
        const payId = crypto.randomUUID();
        const remoteStatus = remote.status;
        if (remoteStatus === "aprovado" || remoteStatus === "autorizado") {
          await db.insert(schema.payments).values({
            id: payId,
            orderId,
            provider: adapter.provider,
            method: input.paymentMethod,
            status: remoteStatus,
            amountCents,
            authorizedCents: remoteStatus === "autorizado" ? amountCents : null,
            payload: remote.raw ? JSON.stringify(remote.raw) : null,
            createdAt: new Date(),
          });
          const to = remoteStatus === "aprovado" ? "pagamento_aprovado" : "pagamento_em_processamento";
          await transitionOrder(db, { orderId, to, reason: "Cobrança confirmada por consulta ao gateway após falha de comunicação", actorLabel: "checkout" });
          finalStatus = to;
          paymentResult = {
            method: input.paymentMethod,
            provider: adapter.provider,
            status: remoteStatus,
            providerTransactionId: "",
          };
          throw serviceUnavailable(
            "gateway_timeout_resolved",
            "O gateway registrou a cobrança durante a instabilidade. O pedido segue conforme o estado registrado — aguarde a confirmação ou verifique em seus pedidos.",
          );
        }
        if (remoteStatus === "pendente") {
          // Cobrança criada e aguardando confirmação financeira: NADA é
          // cancelado. Pedido permanece aguardando_pagamento com estoque
          // reservado; o webhook/reconciliação resolve o resultado real.
          await db.insert(schema.payments).values({
            id: payId,
            orderId,
            provider: adapter.provider,
            method: input.paymentMethod,
            status: "pendente",
            amountCents,
            payload: remote.raw ? JSON.stringify(remote.raw) : null,
            createdAt: new Date(),
          });
          await audit(db, {
            action: "checkout.gateway_unknown_result",
            entity: "order",
            entityId: orderId,
            actorLabel: "checkout",
            after: { provider: adapter.provider, remoteStatus, recovered: true },
          });
          throw serviceUnavailable(
            "gateway_unknown_result",
            "A cobrança foi criada no gateway, mas o resultado ainda não foi confirmado. O pedido permanece reservado — aguarde a confirmação financeira.",
          );
        }
        // recusado/expirado/estornado no provedor = falha definitiva.
        await transitionOrder(db, {
          orderId,
          to: "cancelado",
          reason: `Falha do gateway ${adapter.provider} (cobrança recusada/expirada no provedor): ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
          actorLabel: "checkout",
        });
        finalStatus = "cancelado";
        throw serviceUnavailable(
          "gateway_unavailable",
          "Gateway indisponível no momento — tente novamente em instantes ou escolha outra forma de pagamento.",
        );
      }

      if (remote === null) {
        // Provedor CONFIRMA que não há cobrança: falha definitiva, cancela
        // com segurança (estoque liberado).
        await transitionOrder(db, {
          orderId,
          to: "cancelado",
          reason: `Falha do gateway ${adapter.provider} (sem cobrança no provedor): ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
          actorLabel: "checkout",
        });
        finalStatus = "cancelado";
        throw serviceUnavailable(
          "gateway_unavailable",
          "Gateway indisponível no momento — tente novamente em instantes ou escolha outra forma de pagamento.",
        );
      }

      // Desconhecido (sem queryPaymentByOrder ou consulta falhou): NÃO
      // cancela, NÃO libera estoque. Pedido permanece aguardando_pagamento
      // com reserva; pagamento fica pendente sem referência; a
      // reconciliação resolve quando o provedor responder.
      await db.insert(schema.payments).values({
        id: crypto.randomUUID(),
        orderId,
        provider: adapter.provider,
        method: input.paymentMethod,
        status: "pendente",
        amountCents,
        createdAt: new Date(),
      });
      await audit(db, {
        action: "checkout.gateway_unknown_result",
        entity: "order",
        entityId: orderId,
        actorLabel: "checkout",
        after: { provider: adapter.provider, error: error instanceof Error ? error.message : String(error) },
      });
      throw serviceUnavailable(
        "gateway_unknown_result",
        "Não foi possível confirmar a cobrança no gateway — o pedido permanece reservado e será conciliado automaticamente. Tente novamente em instantes ou aguarde a confirmação.",
      );
    }

    let finalPaymentStatus: "pendente" | "autorizado" | "aprovado" | "recusado" = created.status;
    if (created.status === "autorizado" && !captureAfterReview && risk.level === "baixo") {
      let captured;
      try {
        captured = await adapter.capture(created.providerTransactionId, amountCents);
      } catch (error) {
        // ---- Captura com timeout: a AUTORIZAÇÃO existe (dinheiro reservado
        // no emissor) — cancelar é proibido. Pagamento fica `autorizado`,
        // pedido vai para pagamento_em_processamento (estado coerente:
        // autorização aguardando captura), 503. Reconciliação/conciliação
        // resolve a captura depois.
        await db.insert(schema.payments).values({
          id: crypto.randomUUID(),
          orderId,
          provider: adapter.provider,
          method: input.paymentMethod,
          status: "autorizado",
          amountCents,
          authorizedCents: amountCents,
          providerTransactionId: created.providerTransactionId,
          payload: created.payload ?? null,
          expiresAt: created.expiresAt ?? null,
          createdAt: new Date(),
        });
        await transitionOrder(db, {
          orderId,
          to: "pagamento_em_processamento",
          reason: `Captura com resultado desconhecido no gateway ${adapter.provider}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
          actorLabel: "checkout",
        });
        finalStatus = "pagamento_em_processamento";
        await audit(db, {
          action: "checkout.capture_unknown_result",
          entity: "order",
          entityId: orderId,
          actorLabel: "checkout",
          after: { providerTransactionId: created.providerTransactionId, error: error instanceof Error ? error.message : String(error) },
        });
        paymentResult = {
          method: input.paymentMethod,
          provider: adapter.provider,
          status: "autorizado",
          payload: created.payload,
          expiresAt: created.expiresAt,
          providerTransactionId: created.providerTransactionId,
        };
        throw serviceUnavailable(
          "capture_unknown_result",
          "A cobrança foi autorizada, mas a confirmação da captura está pendente no gateway. O pedido permanece reservado — aguarde a confirmação.",
        );
      }
      finalPaymentStatus = captured.status;
    }

    await db.insert(schema.payments).values({
      id: crypto.randomUUID(),
      orderId,
      provider: adapter.provider,
      method: input.paymentMethod,
      status: finalPaymentStatus === "aprovado" ? "aprovado" : finalPaymentStatus === "autorizado" ? "autorizado" : finalPaymentStatus === "recusado" ? "recusado" : "pendente",
      amountCents,
      authorizedCents: finalPaymentStatus === "aprovado" || finalPaymentStatus === "autorizado" ? amountCents : null,
      providerTransactionId: created.providerTransactionId,
      payload: created.payload ?? null,
      expiresAt: created.expiresAt ?? null,
      capturedAt: finalPaymentStatus === "aprovado" ? new Date() : null,
      createdAt: new Date(),
    });

    // ---- Estado do pedido derivado EXCLUSIVAMENTE do resultado financeiro:
    //   aprovado (cartão capturado)       → pagamento_aprovado
    //   autorizado (captura após revisão) → pagamento_em_processamento
    //   pendente (PIX/boleto criados)     → permanece aguardando_pagamento
    //   recusado                          → cancelado (libera estoque)
    const payRows = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    const paymentRow = payRows[0]!;
    if (finalPaymentStatus === "aprovado") {
      await transitionOrder(db, { orderId, to: "pagamento_aprovado", actorLabel: "checkout" });
      finalStatus = "pagamento_aprovado";
    } else if (finalPaymentStatus === "autorizado") {
      await transitionOrder(db, { orderId, to: "pagamento_em_processamento", actorLabel: "checkout" });
      finalStatus = "pagamento_em_processamento";
    } else if (finalPaymentStatus === "recusado") {
      await transitionOrder(db, { orderId, to: "cancelado", reason: "Pagamento recusado", actorLabel: "checkout" });
      finalStatus = "cancelado";
    }

    paymentResult = {
      method: input.paymentMethod,
      provider: adapter.provider,
      status: finalPaymentStatus,
      payload: created.payload,
      expiresAt: created.expiresAt,
      providerTransactionId: created.providerTransactionId,
    };

    // ---- Corrida checkout×webhook: o webhook pode ter chegado ENTRE o
    // createPayment no provedor e o INSERT do pagamento local. Eventos
    // pendentes gravados sem paymentId são aplicados agora.
    await applyPendingEventsForPayment(db, {
      provider: adapter.provider,
      payment: paymentRow,
      adapterParseWebhook: (raw) => adapter.parseWebhook(raw),
    });
    const [reloaded] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    if (reloaded && reloaded.status !== finalStatus) {
      // O webhook aplicou algo entre a transição e aqui — o resultado do
      // checkout reflete o estado real.
      finalStatus = reloaded.status as OrderStatus;
      const reloadedPay = (await db.select().from(schema.payments).where(eq(schema.payments.id, paymentRow.id)))[0];
      if (reloadedPay) {
        paymentResult.status = (reloadedPay.status === "aprovado"
          ? "aprovado"
          : reloadedPay.status === "recusado"
            ? "recusado"
            : reloadedPay.status === "autorizado"
              ? "autorizado"
              : "pendente") as PaymentStatus;
      }
    }
  }

  checkoutCache.set(fingerprint, { orderId, expiresAt: Date.now() + 5 * 60 * 1000 });

  await audit(db, {
    action: "order.created",
    entity: "order",
    entityId: orderId,
    after: { number: orderNumber, totalCents: amountCents, risk: risk.level, score: risk.score },
    ip: context.ip,
    correlationId: context.correlationId,
  });

  return { orderId, orderNumber, status: finalStatus, payment: paymentResult };
}
