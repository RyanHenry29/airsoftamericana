// language: TS, file: apps/api/src/services/payments-integrity.test.ts, target: vitest + PGlite
// AUD-01 / AUD-15 — integridade financeira: gateway, máquina de estados,
// idempotência de webhook, regressão, pagamento tardio e corrida checkout×webhook.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { handleCheckout } from "./checkout.js";
import { applyPaymentEvent, applyPendingEventsForPayment } from "./payments/webhook-events.js";
import { SandboxAdapter } from "./payments/sandbox.js";
import { and, eq } from "drizzle-orm";
import type { NormalizedWebhookEvent } from "./payments/types.js";

const customerEmail = "integridade@demo.com";

let db: any;

async function clearTables() {
  await db.execute(`DELETE FROM "payment_events"`).catch(() => {});
  await db.execute(`DELETE FROM "idempotency_keys"`).catch(() => {});
  await db.execute(`DELETE FROM "refunds"`).catch(() => {});
  await db.execute(`DELETE FROM "payments"`).catch(() => {});
  await db.execute(`DELETE FROM "chargeback_evidence"`).catch(() => {});
  await db.execute(`DELETE FROM "chargebacks"`).catch(() => {});
  await db.execute(`DELETE FROM "shipping_events"`).catch(() => {});
  await db.execute(`DELETE FROM "shipments"`).catch(() => {});
  await db.execute(`DELETE FROM "fraud_review_events"`).catch(() => {});
  await db.execute(`DELETE FROM "fraud_assessments"`).catch(() => {});
  await db.execute(`DELETE FROM "order_status_history"`).catch(() => {});
  await db.execute(`DELETE FROM "order_items"`).catch(() => {});
  await db.execute(`DELETE FROM "orders"`).catch(() => {});
  await db.execute(`DELETE FROM "inventory_movements"`).catch(() => {});
  await db.execute(`DELETE FROM "watchlist"`).catch(() => {});
  await db.execute(`DELETE FROM "cart_items"`).catch(() => {});
  await db.execute(`DELETE FROM "carts"`).catch(() => {});
  await db.execute(`DELETE FROM "coupons"`).catch(() => {});
  await db.execute(`DELETE FROM "gateway_configs"`).catch(() => {});
  await db.execute(`DELETE FROM "fraud_rules"`).catch(() => {});
  await db.execute(`DELETE FROM "daily_metrics"`).catch(() => {});
  await db.execute(`DELETE FROM "inventory"`).catch(() => {});
  await db.execute(`DELETE FROM "product_images"`).catch(() => {});
  await db.execute(`DELETE FROM "product_specs"`).catch(() => {});
  await db.execute(`DELETE FROM "related_products"`).catch(() => {});
  await db.execute(`DELETE FROM "product_variants"`).catch(() => {});
  await db.execute(`DELETE FROM "products"`).catch(() => {});
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

async function getCustomerId() {
  const rows = await db.select().from(schema.customers).where(eq(schema.customers.email, customerEmail));
  const adult = { ageVerifiedAt: new Date(), bornAt: new Date("1990-01-01T00:00:00.000Z") };
  if (rows.length === 0) {
    const inserted = await db
      .insert(schema.customers)
      .values({
        name: "Cliente Integridade",
        email: customerEmail,
        passwordHash: "hash",
        cpf: "12345678901",
        phone: "19999999999",
        ...(adult as any),
      })
      .returning();
    return inserted[0]!.id;
  }
  await db.update(schema.customers).set(adult as any).where(eq(schema.customers.id, rows[0]!.id));
  return rows[0]!.id;
}

async function getVariant() {
  let [cat] = await db.select().from(schema.categories).limit(1);
  if (!cat) {
    const inserted = await db.insert(schema.categories).values({
      name: "Integridade",
      slug: "integridade",
      active: true,
    }).returning();
    cat = inserted[0]!;
  }
  let [brand] = await db.select().from(schema.brands).limit(1);
  if (!brand) {
    const inserted = await db.insert(schema.brands).values({ name: "Integ", slug: "integ" }).returning();
    brand = inserted[0]!;
  }
  const [prod] = await db.insert(schema.products).values({
    name: "Produto Integridade",
    slug: "produto-integridade",
    categoryId: cat.id,
    brandId: brand.id,
    published: true,
  }).returning();
  const [variant] = await db.insert(schema.productVariants).values({
    productId: prod.id,
    sku: "SKU-INTEG",
    name: "Produto Integridade",
    priceCents: 10000,
    active: true,
  }).returning();
  await db.insert(schema.inventory).values({
    variantId: variant.id,
    physical: 10,
    reserved: 0,
    minQuantity: 0,
  });
  return variant;
}

function addr() {
  return {
    recipient: "Cliente Teste",
    zip: "13000000",
    street: "Rua Teste",
    number: "100",
    complement: "",
    neighborhood: "Centro",
    city: "Americana",
    state: "SP",
    country: "BR",
  };
}

async function seedSandboxGateway() {
  await db.insert(schema.gatewayConfigs).values({
    id: crypto.randomUUID(),
    provider: "sandbox",
    enabled: true,
    isDefault: true,
    methods: ["pix", "cartao", "boleto"],
    pixDiscountPercent: 0,
  });
}

async function checkout(db: any, customerId: string, variantId: string, opts: { method?: string; cardToken?: string } = {}) {
  return handleCheckout(
    db,
    {
      items: [{ variantId, quantity: 1 }],
      address: addr(),
      paymentMethod: (opts.method ?? "pix") as any,
      cardToken: opts.cardToken,
      acceptedTerms: true,
      ageConfirmed: true,
    } as any,
    { customerId, ip: "127.0.0.1", correlationId: crypto.randomUUID() },
  );
}

function approvedEvent(pay: { providerTransactionId: string | null; amountCents: number }, i = 0): NormalizedWebhookEvent {
  return {
    eventId: `integ:${pay.providerTransactionId}:${i}`,
    type: "payment.approved",
    providerTransactionId: pay.providerTransactionId!,
    amountCents: pay.amountCents,
    raw: { id: `${i}`, type: "payment.approved", data: { transactionId: pay.providerTransactionId } },
  };
}

describe("integridade de pagamentos (AUD-01/AUD-15)", () => {
  beforeEach(async () => {
    await clearTables();
  });

  it("cartão recusado → pedido cancelado e estoque liberado", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id, { method: "cartao", cardToken: "sandbox-decline" });

    expect(result.status).toBe("cancelado");
    expect(result.payment.status).toBe("recusado");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("cancelado");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(0);
  });

  it("cartão aprovado com captura → pagamento_aprovado DERIVADO do resultado financeiro", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id, { method: "cartao", cardToken: "ok" });

    // Sandbox autoriza e o checkout captura (risk baixo, captureAfterReview=false).
    expect(result.status).toBe("pagamento_aprovado");
    expect(result.payment.status).toBe("aprovado");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    expect(pay!.status).toBe("aprovado");
    expect(pay!.capturedAt).toBeTruthy();
  });

  it("webhook payment.approved em pedido aguardando_pagamento (PIX) → pagamento_aprovado", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    expect(result.status).toBe("aguardando_pagamento");

    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: approvedEvent(pay),
      payment: pay,
      actorLabel: "webhook:sandbox",
    });

    expect(outcome.applied).toBe(true);
    expect(outcome.orderTransitioned).toEqual({ from: "aguardando_pagamento", to: "pagamento_aprovado" });
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
  });

  it("webhook DUPLICADO: evento repetido é no-op financeiro", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    const event = approvedEvent(pay);

    const first = await applyPaymentEvent(db, { provider: "sandbox", event, payment: pay });
    expect(first.applied).toBe(true);

    const [payReloaded] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    const second = await applyPaymentEvent(db, { provider: "sandbox", event: approvedEvent(pay, 1), payment: payReloaded });
    // Já está aprovado — mesmo eventId diferente é "already_applied".
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("already_applied");

    // Histórico de transição: exatamente UMA entrada para pagamento_aprovado.
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    const approvals = history.filter((h: any) => h.toStatus === "pagamento_aprovado");
    expect(approvals.length).toBe(1);
  });

  it("REGRESSÃO: payment.recused após aprovado é ignorado e auditado", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id, { method: "cartao", cardToken: "ok" });
    expect(result.status).toBe("pagamento_aprovado");

    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: { eventId: "integ:late-recuse", type: "payment.recused", providerTransactionId: pay.providerTransactionId!, raw: {} },
      payment: pay,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("payment_regression_ignored");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const [auditRow] = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "payment.regression_ignored"));
    expect(auditRow).toBeTruthy();
  });

  it("PAGAMENTO TARDIO: approved sobre pedido cancelado → estado preservado, estorno requerido", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    // Cancelamento manual antes do pagamento entrar.
    await db.update(schema.orders).set({ status: "cancelado" }).where(eq(schema.orders.id, result.orderId));
    await db.insert(schema.orderStatusHistory).values({
      id: crypto.randomUUID(),
      orderId: result.orderId,
      fromStatus: "aguardando_pagamento",
      toStatus: "cancelado",
      actorType: "user",
      actorSystem: false,
      createdAt: new Date(),
    });

    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: approvedEvent(pay),
      payment: pay,
    });

    expect(outcome.latePayment).toBe(true);
    expect(outcome.orderTransitioned).toBeUndefined();
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("cancelado"); // cancelado é terminal — não reabre
    const [auditRow] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "order.late_payment"));
    expect(auditRow).toBeTruthy();
    const after = typeof auditRow!.afterJson === "string" ? JSON.parse(auditRow!.afterJson) : auditRow!.afterJson;
    expect(after.decision).toBe("refund_required");
  });

  it("webhook payment.expired em PIX pendente → cancelado com estoque liberado", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: { eventId: "integ:expire", type: "payment.expired", providerTransactionId: pay.providerTransactionId!, raw: {} },
      payment: pay,
    });

    expect(outcome.orderTransitioned).toEqual({ from: "aguardando_pagamento", to: "cancelado" });
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(0);
  });

  it("CORRIDA checkout×webhook: evento estacionado é aplicado quando o pagamento existe", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    // Simula o webhook que chegou entre createPayment e o INSERT local:
    // evento gravado sem paymentId e sem processedAt.
    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "race-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: adapter.parseWebhook(raw).eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });

    const outcome = await applyPendingEventsForPayment(db, {
      provider: "sandbox",
      payment: pay,
      adapterParseWebhook: (r) => adapter.parseWebhook(r),
    });

    expect(outcome?.orderTransitioned).toEqual({ from: "aguardando_pagamento", to: "pagamento_aprovado" });
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const [evt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.provider, "sandbox"));
    expect(evt.processedAt).toBeTruthy();
    expect(evt.paymentId).toBe(pay.id);
  });

  it("CONCORRÊNCIA: dois webhooks approved em paralelo → UMA transição de aprovação", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const ev1 = approvedEvent(pay, 1);
    const ev2 = approvedEvent(pay, 2);

    const [a, b] = await Promise.all([
      applyPaymentEvent(db, { provider: "sandbox", event: ev1, payment: pay }),
      applyPaymentEvent(db, { provider: "sandbox", event: ev2, payment: pay }),
    ]);

    const transitions = [a.orderTransitioned, b.orderTransitioned].filter(Boolean);
    // No máximo UMA transição real de aprovação; a outra é already_applied/regressão-ignorada.
    expect(transitions.length).toBeLessThanOrEqual(1);

    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    const approvals = history.filter((h: any) => h.toStatus === "pagamento_aprovado");
    expect(approvals.length).toBe(1);
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
  });
});

// ---------------------------------------------------------------------------
// Cenários obrigatórios da revisão (ponto 8): crash-safety, reentrega,
// idempotência com hash-compare, divergência de valor, timeout ambíguo e
// recuperação no boot.
// ---------------------------------------------------------------------------

import {
  recoverPendingEvents,
  repairPartialApplications,
} from "./payments/webhook-events.js";
import { registerAdapter, type PaymentAdapter } from "./payments/types.js";
import {
  resetSandboxCharges,
} from "./payments/sandbox.js";
import type {
  CaptureResult,
  CreatePaymentInput,
  CreatePaymentResult,
  QueryPaymentResult,
  RefundResult,
} from "./payments/types.js";

/**
 * Fixture: gateway que ACEITA a cobrança e só então sofre timeout — o
 * registerCharge registra a cobrança no "provedor" antes do throw.
 */
class TimeoutAdapter implements PaymentAdapter {
  readonly provider = "timeout-gw";
  readonly signatureHeader = "x-signature";
  private charges = new Map<string, { status: QueryPaymentResult["status"] }>();

  isConfigured() {
    return true;
  }
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const tx = `tmt_${crypto.randomUUID()}`;
    this.charges.set(input.orderId, { status: "pendente" });
    // A cobrança existe no provedor; a RESPOSTA se perde (timeout).
    throw new Error("timeout after charge created");
  }
  async capture(): Promise<CaptureResult> {
    return { status: "aprovado", amountCents: 0 };
  }
  async refund(): Promise<RefundResult> {
    return { providerRefundId: "tmt_rf", status: "estornado" };
  }
  verifyWebhookSignature() {
    return true;
  }
  parseWebhook(raw: string): NormalizedWebhookEvent {
    return { eventId: "tmt:1", type: "payment.approved", raw };
  }
  async queryPaymentByOrder(orderId: string): Promise<QueryPaymentResult | null> {
    const charge = this.charges.get(orderId);
    return charge ? { status: charge.status, amountCents: 10000, currency: "BRL" } : null;
  }
}

describe("recuperação e idempotência (revisão PR #1, ponto 8)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
  });

  it("CRASH após persistir evento, antes da transição: boot reaplica o evento pendente", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    // Estado do crash: evento persistido (processed_at NULL), nada aplicado.
    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "crash-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: adapter.parseWebhook(raw).eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });

    const summary = await recoverPendingEvents(db);
    expect(summary.applied).toBe(1);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const [evt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.provider, "sandbox"));
    expect(evt.processedAt).toBeTruthy();
    expect(evt.paymentId).toBe(pay.id);
  });

  it("CRASH após update do pagamento: estado parcial (pagamento aprovado, pedido aguardando) é reparado no boot", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);

    // Estado parcial legado: pagamento atualizado, pedido não.
    await db.update(schema.payments).set({ status: "aprovado", capturedAt: new Date() }).where(eq(schema.payments.orderId, result.orderId));
    let [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("aguardando_pagamento"); // divergência existe

    const { repaired } = await repairPartialApplications(db);
    expect(repaired).toBe(1);

    [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const [auditRow] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "payment.partial_repair"));
    expect(auditRow).toBeTruthy();
  });

  it("webhook DUPLICADO após falha parcial: reentrega consolida estado e marca o evento", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "redelivery-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    const event = adapter.parseWebhook(raw);
    const inserted = await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: event.eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    }).returning();

    // Falha parcial prévia: pagamento aprovado, pedido aguardando, evento pendente.
    await db.update(schema.payments).set({ status: "aprovado" }).where(eq(schema.payments.id, pay.id));

    // Reentrega do MESMO evento: idempotente (already_applied) e marca processedAt.
    const first = await applyPaymentEvent(db, { provider: "sandbox", event, payment: pay, eventRowId: (inserted[0] as { id: string }).id });
    expect(first.reason).toBe("already_applied");
    const [evtAfterApply] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.eventId, event.eventId));
    expect(evtAfterApply!.processedAt).toBeTruthy();

    // O reparo consolida o pedido (crash-safety de estado parcial).
    await repairPartialApplications(db);
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");

    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(1);
  });

  it("MESMA Idempotency-Key com carrinhos diferentes → 409 idempotency_key_reuse", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const base = {
      address: addr(),
      paymentMethod: "pix" as const,
      acceptedTerms: true,
      ageConfirmed: true,
    };

    const a = await handleCheckout(
      db,
      { ...base, items: [{ variantId: variant.id, quantity: 1 }] } as any,
      { customerId, ip: "127.0.0.1", idempotencyKey: "fixa-1" },
    );

    // Mesma chave, payload DIFERENTE (quantidade 2) → 409, nunca herda o pedido.
    await expect(
      handleCheckout(
        db,
        { ...base, items: [{ variantId: variant.id, quantity: 2 }] } as any,
        { customerId, ip: "127.0.0.1", idempotencyKey: "fixa-1" },
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse", status: 409 });

    const orders = await db.select().from(schema.orders);
    expect(orders.length).toBe(1);
    expect(orders[0]!.id).toBe(a.orderId);

    // Mesma chave, MESMO payload → replay do mesmo pedido (idempotência real).
    const replay = await handleCheckout(
      db,
      { ...base, items: [{ variantId: variant.id, quantity: 1 }] } as any,
      { customerId, ip: "127.0.0.1", idempotencyKey: "fixa-1" },
    );
    expect(replay.orderId).toBe(a.orderId);
  });

  it("MESMO carrinho com cupom diferente → fingerprints diferentes → DOIS pedidos", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();
    await db.insert(schema.coupons).values({
      code: "INTEG10",
      kind: "valor",
      value: 500,
      active: true,
    });

    const base = {
      items: [{ variantId: variant.id, quantity: 1 }],
      address: addr(),
      paymentMethod: "pix" as const,
      acceptedTerms: true,
      ageConfirmed: true,
    };

    const withoutCoupon = await handleCheckout(db, base as any, { customerId, ip: "127.0.0.1" });
    const withCoupon = await handleCheckout(db, { ...base, couponCode: "INTEG10" } as any, { customerId, ip: "127.0.0.1" });

    // Cupom muda o significado financeiro → NÃO pode herdar o pedido anterior.
    expect(withoutCoupon.orderId).not.toBe(withCoupon.orderId);
    const orders = await db.select().from(schema.orders);
    expect(orders.length).toBe(2);

    const keys = await db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.action, "checkout"));
    expect(new Set(keys.map((k: any) => k.payloadHash)).size).toBe(2);
  });

  it("VALOR divergente: webhook com valor diferente do cobrado NÃO aprova", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: {
        eventId: "integ:amount-divergent",
        type: "payment.approved",
        providerTransactionId: pay.providerTransactionId!,
        amountCents: pay.amountCents - 1, // divergente
        raw: {},
      },
      payment: pay,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("amount_mismatch");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    expect(payAfter!.status).toBe("pendente");
    const [auditRow] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "payment.event_rejected"));
    expect(auditRow).toBeTruthy();
  });

  it("GATEWAY aceita a cobrança mas a resposta sofre timeout: pedido NÃO cancela, estoque fica reservado, 503", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const fixture = new TimeoutAdapter();
    registerAdapter(fixture);
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "timeout-gw",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });

    await expect(
      checkout(db, customerId, variant.id),
    ).rejects.toMatchObject({ code: "gateway_unknown_result", status: 503 });

    const orders = await db.select().from(schema.orders);
    expect(orders.length).toBe(1);
    expect(orders[0]!.status).toBe("aguardando_pagamento");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1); // reserva preservada — cobrança pode existir
    const pays = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orders[0]!.id));
    expect(pays.length).toBe(1);
    expect(pays[0]!.status).toBe("pendente");
    const [auditRow] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "checkout.gateway_unknown_result"));
    expect(auditRow).toBeTruthy();
  });

  it("DUAS INSTÂNCIAS no mesmo evento simultaneamente: transição única e estado consistente", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "race-instance-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    const event = adapter.parseWebhook(raw);
    const inserted = await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: event.eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    }).returning();
    const eventRowId = (inserted[0] as { id: string }).id;

    // Duas instâncias processam o MESMO evento (mesma linha) em paralelo.
    const [a, b] = await Promise.all([
      applyPaymentEvent(db, { provider: "sandbox", event, payment: pay, eventRowId }),
      applyPaymentEvent(db, { provider: "sandbox", event, payment: pay, eventRowId }),
    ]);

    const transitions = [a.orderTransitioned, b.orderTransitioned].filter(Boolean);
    expect(transitions.length).toBeLessThanOrEqual(1);
    expect(a.applied || b.applied).toBe(true);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const [evt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, eventRowId));
    expect(evt.processedAt).toBeTruthy();
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(1);
  });

  it("RECUPERAÇÃO de eventos pendentes após reinicialização: idempotente, segunda passada vazia", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const adapter = new SandboxAdapter();
    for (const id of ["boot-1", "boot-2"]) {
      const raw = JSON.stringify({ id, type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
      await db.insert(schema.paymentEvents).values({
        provider: "sandbox",
        eventId: adapter.parseWebhook(raw).eventId,
        type: "payment.approved",
        payload: JSON.parse(raw),
        signatureValid: true,
        processedAt: null,
      });
    }

    const firstRun = await recoverPendingEvents(db);
    expect(firstRun.scanned).toBe(2);
    expect(firstRun.applied).toBe(2);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");

    // "Reinicialização": segunda passada não encontra pendentes e não re-transiciona.
    const secondRun = await recoverPendingEvents(db);
    expect(secondRun.scanned).toBe(0);
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Revisão v3 (pontos A–D): fila multi-instância com dead-letter, reparo
// idempotente, expiração segura de reservas e vinculação de conta.
// ---------------------------------------------------------------------------

import { expireStaleReservations } from "./payments/expiry.js";

/** Cobrança VIVA no provedor: expiração NUNCA libera estoque dela. */
class AliveChargeAdapter implements PaymentAdapter {
  readonly provider: string = "exp-alive";
  readonly signatureHeader = "x-signature";
  isConfigured() { return true; }
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return { providerTransactionId: `exp_${crypto.randomUUID()}`, status: "pendente" };
  }
  async capture(): Promise<CaptureResult> { return { status: "aprovado", amountCents: 0 }; }
  async refund(): Promise<RefundResult> { return { providerRefundId: "rf", status: "estornado" }; }
  verifyWebhookSignature() { return true; }
  parseWebhook(raw: string): NormalizedWebhookEvent { return { eventId: "exp:1", type: "payment.approved", raw }; }
  async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
    return { status: "pendente", amountCents: 10000, currency: "BRL" };
  }
}

/** Provedor confirma AUSÊNCIA de cobrança: expiração definitiva. */
class NoChargeAdapter extends AliveChargeAdapter {
  readonly provider = "exp-none";
  async queryPaymentByOrder(): Promise<QueryPaymentResult | null> { return null; }
}

/** Provedor confirma cobrança APROVADA durante a reserva. */
class ApprovedChargeAdapter extends AliveChargeAdapter {
  readonly provider = "exp-approved";
  async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
    return { status: "aprovado", amountCents: 10000, currency: "BRL" };
  }
}

describe("fila de recuperação multi-instância (revisão v3, ponto A)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
  });

  it("DUAS INSTÂNCIAS rodando recoverPendingEvents em paralelo: sem dupla aplicação", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "multi-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: adapter.parseWebhook(raw).eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });

    const [r1, r2] = await Promise.all([
      recoverPendingEvents(db, { minBackoffMs: 0 }),
      recoverPendingEvents(db, { minBackoffMs: 0 }),
    ]);

    // Estado final consistente independentemente da interleaving:
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(1);
    const [evt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.provider, "sandbox"));
    expect(evt.processedAt).toBeTruthy();
    expect(evt.deadLetter).toBe(false);
    expect(r1.applied + r2.applied).toBeGreaterThanOrEqual(1);
  });

  it("payload PERMANENTEMENTE inválido → dead-letter imediato, fila não bloqueia", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();
    await checkout(db, customerId, variant.id);

    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: "sandbox:invalid-1",
      type: "payment.approved",
      payload: { corpo: "que não parseia como evento sandbox" },
      signatureValid: true,
      processedAt: null,
    });

    const first = await recoverPendingEvents(db, { minBackoffMs: 0 });
    expect(first.deadLettered).toBe(1);
    expect(first.applied).toBe(0);

    // Segunda passada: fila limpa.
    const second = await recoverPendingEvents(db, { minBackoffMs: 0 });
    expect(second.scanned).toBe(0);
    // audit_logs persiste entre testes — escopa pela linha do evento.
    const [insertedEvt] = await db
      .select()
      .from(schema.paymentEvents)
      .where(eq(schema.paymentEvents.eventId, "sandbox:invalid-1"));
    const [auditRow] = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "payment.event_dead_letter"), eq(schema.auditLogs.entityId, insertedEvt!.id)));
    expect(auditRow).toBeTruthy();
    const after = typeof auditRow!.afterJson === "string" ? JSON.parse(auditRow!.afterJson) : auditRow!.afterJson;
    expect(after.reason).toBe("invalid_payload");
  });

  it("evento estacionado além da IDADE → dead-letter (fila nunca bloqueia indefinidamente)", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();
    await checkout(db, customerId, variant.id);

    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "parked-limit", type: "payment.approved", data: { transactionId: "sbx_inexistente" } });
    // Criado há 2 dias — além do maxAgeDays de 1 dia passado como opção.
    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: adapter.parseWebhook(raw).eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    const summary = await recoverPendingEvents(db, { minBackoffMs: 0, maxAgeDays: 1 });
    expect(summary.parked).toBe(0);
    expect(summary.deadLettered).toBe(1);

    // audit_logs persiste entre testes — escopa pela linha do evento.
    const [insertedEvt] = await db
      .select()
      .from(schema.paymentEvents)
      .where(eq(schema.paymentEvents.eventId, "sandbox:parked-limit"));
    const [auditRow] = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "payment.event_dead_letter"), eq(schema.auditLogs.entityId, insertedEvt!.id)));
    const after = typeof auditRow!.afterJson === "string" ? JSON.parse(auditRow!.afterJson) : auditRow!.afterJson;
    expect(after.reason).toBe("payment_never_arrived");
  });

  it("TENTATIVAS nunca descartam evento estacionado — referência ainda NÃO DISPONÍVEL é preservada", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();
    await checkout(db, customerId, variant.id);

    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "parked-attempts", type: "payment.approved", data: { transactionId: "sbx_inexistente" } });
    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: adapter.parseWebhook(raw).eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });
    // Simula evento reentregado 99 vezes: tentativas estouradas, idade baixa.
    await db
      .update(schema.paymentEvents)
      .set({ attempts: 99, lastAttemptAt: null })
      .where(eq(schema.paymentEvents.eventId, "sandbox:parked-attempts"));

    const summary = await recoverPendingEvents(db, { minBackoffMs: 0, maxAttempts: 10, maxAgeDays: 30 });
    // Tentativas estouradas e AINDA ASSIM permanece estacionado — a corrida
    // checkout×webhook pode resolver a qualquer momento (checkout absorve).
    expect(summary.parked).toBe(1);
    expect(summary.deadLettered).toBe(0);
    const [evt] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.eventId, "sandbox:parked-attempts"));
    expect(evt.deadLetter).toBe(false);
    expect(evt.processedAt).toBeNull();
  });

  it("LEASE ativo → outro worker NÃO reivindica; lease expirado → evento volta à fila", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "lease-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: adapter.parseWebhook(raw).eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });

    // Lease em posse de outro worker (expira em 1 h): nada acontece.
    await db
      .update(schema.paymentEvents)
      .set({ leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000) })
      .where(eq(schema.paymentEvents.eventId, "sandbox:lease-1"));
    const heldRun = await recoverPendingEvents(db, { minBackoffMs: 0 });
    expect(heldRun.skippedLease).toBe(1);
    expect(heldRun.applied).toBe(0);
    const [held] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.eventId, "sandbox:lease-1"));
    expect(held.processedAt).toBeNull(); // não aplicado, não dead-letter
    expect(held.deadLetter).toBe(false);

    // Lease EXPIRADO (crash do worker): evento volta à fila e é aplicado.
    await db
      .update(schema.paymentEvents)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.paymentEvents.eventId, "sandbox:lease-1"));
    const recovered = await recoverPendingEvents(db, { minBackoffMs: 0 });
    expect(recovered.applied).toBe(1);
    const [done] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.eventId, "sandbox:lease-1"));
    expect(done.processedAt).toBeTruthy();
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
  });

  it("divergência financeira recorrente além do limite → dead-letter com motivo", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const adapter = new SandboxAdapter();
    const raw = JSON.stringify({ id: "divergent-limit", type: "payment.approved", data: { transactionId: pay.providerTransactionId, amountCents: 999 } });
    await db.insert(schema.paymentEvents).values({
      provider: "sandbox",
      eventId: adapter.parseWebhook(raw).eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });

    const summary = await recoverPendingEvents(db, { minBackoffMs: 0, maxAttempts: 1 });
    expect(summary.rejected).toBe(1);
    expect(summary.deadLettered).toBe(1);
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("aguardando_pagamento"); // divergência nunca aprova
  });
});

describe("reparo idempotente no boot (revisão v3, ponto B)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
  });

  it("REINICIALIZAÇÃO repetida: uma única transição, uma única auditoria, estoque liberado uma vez", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    // Estado parcial legado: pagamento recusado + pedido aguardando (libera estoque).
    await db.update(schema.payments).set({ status: "recusado" }).where(eq(schema.payments.orderId, result.orderId));

    const first = await repairPartialApplications(db);
    expect(first.repaired).toBe(1);
    const [invAfterFirst] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(invAfterFirst.reserved).toBe(0);

    // Duas reinicializações seguintes: nada a fazer.
    const second = await repairPartialApplications(db);
    const third = await repairPartialApplications(db);
    expect(second.repaired).toBe(0);
    expect(third.repaired).toBe(0);

    const [invAfterThird] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(invAfterThird.reserved).toBe(0); // estoque nunca liberado duas vezes

    // audit_logs persiste entre testes — escopa pelo pedido deste teste.
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "payment.partial_repair"), eq(schema.auditLogs.entityId, result.orderId)));
    expect(audits.length).toBe(1);
    const after = typeof audits[0]!.afterJson === "string" ? JSON.parse(audits[0]!.afterJson) : audits[0]!.afterJson;
    expect(after.automatic).toBe(true); // distingue correção automática de intervenção humana
    expect(audits[0]!.actorLabel).toBe("recovery:boot");

    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    expect(history.filter((h: any) => h.toStatus === "cancelado").length).toBe(1);
  });

  it("DUAS INSTÂNCIAS reparando em paralelo → UMA transição, UMA auditoria, estoque liberado uma vez", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    await db.update(schema.payments).set({ status: "recusado" }).where(eq(schema.payments.orderId, result.orderId));

    const [r1, r2] = await Promise.all([repairPartialApplications(db), repairPartialApplications(db)]);
    expect(r1.repaired + r2.repaired).toBe(1); // a segunda vê transitioned=false

    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(0);
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "payment.partial_repair"), eq(schema.auditLogs.entityId, result.orderId)));
    expect(audits.length).toBe(1);
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, result.orderId));
    expect(history.filter((h: any) => h.toStatus === "cancelado").length).toBe(1);
  });

  it("CAPTURA PENDENTE é intocada: pagamento autorizado + pedido em_processamento NÃO é reparado", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    // Estado legítimo de captura após revisão: autorizado + em_processamento.
    await db.update(schema.payments).set({ status: "autorizado" }).where(eq(schema.payments.orderId, result.orderId));
    const [orderBefore] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    // Força o pedido para em_processamento (estado que a captura pendente exige).
    await db.update(schema.orders).set({ status: "pagamento_em_processamento" }).where(eq(schema.orders.id, result.orderId));

    const summary = await repairPartialApplications(db);
    expect(summary.repaired).toBe(0); // autorizado não é definitivo — decisão é da captura/humano

    const [orderAfter] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(orderAfter!.status).toBe("pagamento_em_processamento");
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    expect(pay!.status).toBe("autorizado");
    void orderBefore;
  });
});

describe("expiração segura de reservas (revisão v3, ponto C)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
  });

  /** Pedido antigo com pagamento pendente — o alvo da expiração. */
  async function staleOrder(provider: string, variantId: string, customerId: string) {
    const created = await handleCheckout(
      db,
      {
        items: [{ variantId, quantity: 1 }],
        address: addr(),
        paymentMethod: "pix",
        acceptedTerms: true,
        ageConfirmed: true,
      } as any,
      { customerId, ip: "127.0.0.1" },
    );
    // Antiguidade da reserva (cutoff de 60 min).
    await db.update(schema.orders).set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }).where(eq(schema.orders.id, created.orderId));
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, created.orderId));
    await db.update(schema.payments).set({ provider }).where(eq(schema.payments.id, pay.id));
    return created.orderId;
  }

  it("cobrança PENDENTE no provedor → expiração NÃO libera estoque (cobrança pode ser confirmada depois)", async () => {
    registerAdapter(new AliveChargeAdapter());
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "exp-alive",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const orderId = await staleOrder("exp-alive", variant.id, customerId);

    const summary = await expireStaleReservations(db, { olderThanMinutes: 60 });
    expect(summary.skipped).toBe(1);
    expect(summary.cancelled).toBe(0);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1); // reserva preservada — cobrança viva
    const [auditRow] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "expiry.skipped_charge_alive"));
    expect(auditRow).toBeTruthy();
  });

  it("provedor confirma AUSÊNCIA de cobrança APÓS a tolerância → cancelamento com estoque liberado (dupla confirmação)", async () => {
    registerAdapter(new NoChargeAdapter());
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "exp-none",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const orderId = await staleOrder("exp-none", variant.id, customerId);

    // notFoundGraceMinutes: 0 → pedido de 3 h está bem além da tolerância;
    // 1ª e 2ª consultas confirmam null → ausência definitiva.
    const summary = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0 });
    expect(summary.cancelled).toBe(1);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("cancelado");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(0);
  });

  it("ausência DENTRO da tolerância → reserva preservada (consistência eventual do provedor)", async () => {
    registerAdapter(new NoChargeAdapter());
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "exp-none",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    // Pedido de 3 h: além do cutoff de 60 min, DENTRO do grace de 24 h.
    const orderId = await staleOrder("exp-none", variant.id, customerId);

    const summary = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 24 * 60 });
    expect(summary.skippedNotFoundGrace).toBe(1);
    expect(summary.cancelled).toBe(0);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1); // cobrança pode ser confirmada depois
    const [auditRow] = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.skipped_notfound_grace"), eq(schema.auditLogs.entityId, orderId)));
    expect(auditRow).toBeTruthy();
  });

  it("DUPLA CONFIRMAÇÃO divergente: 1ª consulta null, 2ª reports cobrança viva → NÃO cancela", async () => {
    // 1ª chamada: null (ausência aparente); 2ª: pendente (apareceu) —
    // simula consistência eventual do provedor.
    class LateAppearAdapter extends AliveChargeAdapter {
      readonly provider = "exp-late";
      private calls = 0;
      async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
        this.calls++;
        return this.calls <= 1 ? null : { status: "pendente", amountCents: 10000, currency: "BRL" };
      }
    }
    registerAdapter(new LateAppearAdapter());
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "exp-late",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const orderId = await staleOrder("exp-late", variant.id, customerId);

    const summary = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0 });
    expect(summary.cancelled).toBe(0);
    expect(summary.skipped).toBe(1); // 2ª consulta: cobrança viva

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1);
  });

  it("expiração IDEMPOTENTE: segunda passada não re-aprova, não re-cancela, não duplica auditoria", async () => {
    registerAdapter(new ApprovedChargeAdapter());
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "exp-approved",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const orderId = await staleOrder("exp-approved", variant.id, customerId);

    const first = await expireStaleReservations(db, { olderThanMinutes: 60 });
    const second = await expireStaleReservations(db, { olderThanMinutes: 60 });
    expect(first.approved).toBe(1);
    expect(second.scanned).toBe(0); // pedido saiu do conjunto pendente

    // audit_logs persiste — escopa pelo pedido deste teste.
    const lateAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.late_confirmation"), eq(schema.auditLogs.entityId, orderId)));
    expect(lateAudits.length).toBe(1);
  });

  it("DUAS INSTÂNCIAS expirando em paralelo → UMA liberação de estoque, UMA auditoria de cancelamento", async () => {
    registerAdapter(new NoChargeAdapter());
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "exp-none",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const orderId = await staleOrder("exp-none", variant.id, customerId);

    const [r1, r2] = await Promise.all([
      expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0 }),
      expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0 }),
    ]);
    expect(r1.cancelled + r2.cancelled).toBe(1);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("cancelado");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(0); // liberado exatamente uma vez
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
    expect(history.filter((h: any) => h.toStatus === "cancelado").length).toBe(1);
    const cancelAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.cancelled"), eq(schema.auditLogs.entityId, orderId)));
    expect(cancelAudits.length).toBe(1);
  });

  it("cobrança APROVADA no provedor durante a reserva → pedido aprovado, nunca cancelado", async () => {
    registerAdapter(new ApprovedChargeAdapter());
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "exp-approved",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const orderId = await staleOrder("exp-approved", variant.id, customerId);

    const summary = await expireStaleReservations(db, { olderThanMinutes: 60 });
    expect(summary.approved).toBe(1);
    expect(summary.cancelled).toBe(0);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const [auditRow] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "expiry.late_confirmation"));
    expect(auditRow).toBeTruthy();
  });

  it("adapter SEM consulta → expiração NUNCA libera às cegas", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway(); // sandbox TEM queryPaymentByOrder — usa rota "sem consulta":
    // Gateway row com provider sandbox mas adapter de teste sem consulta:
    class BlindAdapter extends SandboxAdapter {
      readonly provider = "sandbox";
      async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
        throw new Error("consulta indisponível");
      }
    }
    const sandbox = new BlindAdapter();
    // Substitui o adapter sandbox no registry pela variante cega.
    const { registerAdapter: re } = await import("./payments/types.js");
    re(sandbox);

    const orderId = await staleOrder("sandbox", variant.id, customerId);
    const summary = await expireStaleReservations(db, { olderThanMinutes: 60 });
    expect(summary.skipped).toBe(1);
    expect(summary.cancelled).toBe(0);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1);
  });
});

describe("vinculação da conta do estabelecimento (revisão v3, ponto D)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
  });

  it("evento COM accountId e credenciais SEM accountId → account_unverified, NUNCA aprovação silenciosa", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway(); // sandbox sem accountId nas credenciais

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: {
        eventId: "acct-claim-1",
        type: "payment.approved",
        providerTransactionId: pay.providerTransactionId!,
        amountCents: pay.amountCents,
        accountId: "acct-alegado-123", // claim sem referencial para verificar
        raw: {},
      },
      payment: pay,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("account_unverified");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    // audit_logs persiste entre testes — escopa pelo pagamento deste teste.
    const [auditRow] = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "payment.event_rejected"), eq(schema.auditLogs.entityId, pay.id)));
    expect(auditRow).toBeTruthy();
  });

  it("credenciais COM accountId e evento aprovado SEM accountId → account_binding_missing", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "sandbox",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
      // Credenciais CIFRADAS com accountId configurado:
      credentialsEncrypted: (await import("../lib/crypto.js")).encryptSecret(
        JSON.stringify({ accountId: "loja-oficial-1" }),
      ),
    });

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: {
        eventId: "acct-missing-1",
        type: "payment.approved",
        providerTransactionId: pay.providerTransactionId!,
        amountCents: pay.amountCents,
        raw: {},
      },
      payment: pay,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("account_binding_missing");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("aguardando_pagamento");
  });

  it("nenhum dos lados informa conta → aprovação NÃO silenciosa (advertência auditada), demais validações decidem", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: approvedEvent(pay),
      payment: pay,
      signatureValid: true, // origem autenticada (rota exige assinatura)
    });

    // Aprova com advertência auditada — valor/transação/referência validados.
    expect(outcome.applied).toBe(true);
    const [auditRow] = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "payment.account_binding_missing"), eq(schema.auditLogs.entityId, pay.id)));
    expect(auditRow).toBeTruthy();
    const after = typeof auditRow!.afterJson === "string" ? JSON.parse(auditRow!.afterJson) : auditRow!.afterJson;
    expect(after.origin.signatureVerified).toBe(true); // evidência de origem na advertência
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("pagamento_aprovado");
  });

  it("ASSINATURA NÃO VERIFICADA rejeita SEM exceção — aprovação do caminho sem conta nunca substitui autenticação", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await seedSandboxGateway();

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    // Mesmo com transação/valor/moeda válidos: origem não autenticada → rejeita.
    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: approvedEvent(pay),
      payment: pay,
      signatureValid: false,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("event_not_authenticated");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, result.orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    expect(payAfter!.status).toBe("pendente");
  });

  it("accountId DIVERGENTE do configurado → account_mismatch", async () => {
    const customerId = await getCustomerId();
    const variant = await getVariant();
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "sandbox",
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
      credentialsEncrypted: (await import("../lib/crypto.js")).encryptSecret(
        JSON.stringify({ accountId: "loja-oficial-1" }),
      ),
    });

    const result = await checkout(db, customerId, variant.id);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));

    const outcome = await applyPaymentEvent(db, {
      provider: "sandbox",
      event: {
        eventId: "acct-mismatch-1",
        type: "payment.approved",
        providerTransactionId: pay.providerTransactionId!,
        amountCents: pay.amountCents,
        accountId: "outra-loja-9",
        raw: {},
      },
      payment: pay,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("account_mismatch");
  });
});
