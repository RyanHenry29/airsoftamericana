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
import { resolveActiveAdapter, loadGatewayConfig } from "./payments/types.js";
import { initAdapters } from "./payments/index.js";
import { sha256, CredentialDecryptionError } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import type { CheckoutInput, OrderStatus, PaymentMethod } from "@airsoft/shared";

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  payment: {
    method: PaymentMethod;
    provider: string;
    status: "pendente" | "autorizado" | "aprovado" | "recusado";
    payload?: string;
    expiresAt?: Date;
    providerTransactionId: string;
  };
}

const checkoutCache = new Map<string, { orderId: string; expiresAt: number }>();

export async function handleCheckout(
  db: Db,
  input: CheckoutInput & { deviceFingerprint?: string; cardToken?: string; installments?: number },
  context: { customerId: string; ip?: string; correlationId?: string },
): Promise<CheckoutResult> {
  const fingerprint = sha256(
    JSON.stringify({ c: context.customerId, i: input.items, t: input.paymentMethod, a: input.address }) +
      Math.floor(Date.now() / (5 * 60 * 1000)),
  );
  const cached = checkoutCache.get(fingerprint);
  if (cached && cached.expiresAt > Date.now()) {
    const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, cached.orderId));
    const order = rows[0];
    if (order) {
      const payRows = await db.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
      const payment = payRows[0];
      return {
        orderId: order.id,
        orderNumber: order.number,
        status: order.status,
        payment: payment
          ? {
              method: payment.method,
              provider: payment.provider,
              status: (payment.status === "aprovado" ? "aprovado" : payment.status === "recusado" ? "recusado" : "pendente") as "pendente" | "autorizado" | "aprovado" | "recusado",
              payload: payment.payload ?? undefined,
              expiresAt: payment.expiresAt ?? undefined,
              providerTransactionId: payment.providerTransactionId ?? "",
            }
          : { method: input.paymentMethod, provider: "sandbox", status: "pendente", providerTransactionId: "" },
      };
    }
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
    const adapter = await resolveActiveAdapter(db);
    if (adapter) {
      const cfg = await loadGatewayConfig(db, adapter.provider);
      const pct = cfg?.pixDiscountPercent ?? 0;
      if (pct > 0) {
        const pixDiscount = Math.floor((subtotalCents * pct) / 100);
        amountCents = subtotalCents - discountCents - pixDiscount + shippingCents;
      }
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

  await db.transaction(async (tx) => {
    await tx.insert(schema.orders).values({
      id: orderId,
      number: orderNumber,
      customerId: context.customerId,
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
      actorSystem: true,
      createdAt: new Date(),
    });

    if (couponId) await incrementCouponUsage(tx as unknown as Db, couponId);
  });

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

  await transitionOrder(db, {
    orderId,
    to: "pagamento_em_processamento",
    actorLabel: "system",
  });

  let finalStatus: OrderStatus = "aguardando_pagamento";
  if (risk.level === "alto") {
    finalStatus = "em_analise_antifraude";
    await transitionOrder(db, { orderId, to: "em_analise_antifraude", reason: `Score ${risk.score}: ${risk.reasons[0]?.name ?? ""}`, actorLabel: "antifraude" });
  } else if (risk.level === "medio" || requiresReview) {
    finalStatus = "aguardando_revisao_manual";
    await transitionOrder(db, { orderId, to: "aguardando_revisao_manual", reason: `Score ${risk.score}`, actorLabel: "antifraude" });
  } else {
    finalStatus = "pagamento_aprovado";
    await transitionOrder(db, { orderId, to: "pagamento_aprovado", actorLabel: "system" });
  }

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
  if (!adapter) throw conflict("no_payment_gateway", "Nenhum gateway configurado");

  const gatewayConfig = await loadGatewayConfig(db, adapter.provider);
  const captureAfterReview = gatewayConfig?.captureAfterReview ?? false;

  let paymentResult: CheckoutResult["payment"];
  if (risk.level === "alto") {
    paymentResult = {
      method: input.paymentMethod,
      provider: adapter.provider,
      status: "recusado",
      providerTransactionId: "",
    };
    await db.insert(schema.payments).values({
      id: crypto.randomUUID(),
      orderId,
      provider: adapter.provider,
      method: input.paymentMethod,
      status: "recusado",
      amountCents,
      createdAt: new Date(),
    });
  } else {
    const created = await adapter.createPayment({
      orderId,
      amountCents,
      method: input.paymentMethod,
      customer: { name: customer.name, email: customer.email, cpf: customer.cpf, phone: customer.phone },
      cardToken: input.cardToken,
      installments: input.installments,
    });

    let finalPaymentStatus: "pendente" | "autorizado" | "aprovado" | "recusado" = created.status;
    if (created.status === "autorizado" && !captureAfterReview && risk.level === "baixo") {
      const captured = await adapter.capture(created.providerTransactionId, amountCents);
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
      createdAt: new Date(),
    });

    paymentResult = {
      method: input.paymentMethod,
      provider: adapter.provider,
      status: finalPaymentStatus,
      payload: created.payload,
      expiresAt: created.expiresAt,
      providerTransactionId: created.providerTransactionId,
    };
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