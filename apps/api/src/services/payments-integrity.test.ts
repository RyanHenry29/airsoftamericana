// language: TS, file: apps/api/src/services/payments-integrity.test.ts, target: vitest + PGlite
// AUD-01 / AUD-15 — integridade financeira: gateway, máquina de estados,
// idempotência de webhook, regressão, pagamento tardio e corrida checkout×webhook.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { getDb, type Db } from "../db/index.js";
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
import { registerAdapter, getAdapter, type PaymentAdapter } from "./payments/types.js";
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

    // Revisão v5 (item 4): confirmação independente exige observações em
    // passadas distintas. Passada 1 persiste a primeira observação; passada
    // 2 (janela decorrida) decide.
    const firstPass = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0 });
    expect(firstPass.firstSeenRecorded).toBe(1);
    expect(firstPass.cancelled).toBe(0);
    const summary = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0, confirmWindowMs: 0 });
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

  it("CONFIRMAÇÃO ASSÍNCRONA divergente: 1ª passada null persiste observação e não cancela; cobrança viva após a janela NÃO cancela", async () => {
    // 1ª chamada: null (ausência aparente); 2ª: pendente (apareceu) —
    // simula consistência eventual do provedor. Revisão v5 (item 4): a
    // dupla consulta imediata virou observações em PASSADAS DISTINTAS.
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

    // Passada 1: null → observação persistida; janela ainda não decorrida
    // → NÃO cancela mesmo com grace=0.
    const first = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0 });
    expect(first.cancelled).toBe(0);
    expect(first.firstSeenRecorded).toBe(1);
    expect(first.skippedConfirmWindow).toBe(1);

    // Passada 2 (janela decorrida — confirmWindowMs: 0): consulta reports
    // cobrança VIVA → reserva preservada, sem cancelamento.
    const second = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0, confirmWindowMs: 0 });
    expect(second.cancelled).toBe(0);
    expect(second.skipped).toBe(1);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("aguardando_pagamento");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1);
    const [firstSeenRow] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(firstSeenRow!.notFoundFirstSeenAt).toBeTruthy();
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

    // Revisão v5 (item 4): primeira observação já persistida (passada
    // anterior) — as duas instâncias partem do estado confirmável.
    await db
      .update(schema.payments)
      .set({ notFoundFirstSeenAt: new Date(Date.now() - 30 * 60 * 1000) })
      .where(eq(schema.payments.orderId, orderId));

    const [r1, r2] = await Promise.all([
      expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0, confirmWindowMs: 0 }),
      expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 0, confirmWindowMs: 0 }),
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

// ---------------------------------------------------------------------------
// Revisão v5 — fencing token (itens 1-2), lease de manutenção multi-instância
// (item 3), expiração assíncrona com estado persistido (item 4) e decisão
// atômica da expiração (item 5).
// ---------------------------------------------------------------------------

import { LeaseLostError } from "./payments/webhook-events.js";
import {
  acquireSystemLock,
  renewSystemLock,
  releaseSystemLock,
  withSystemLock,
} from "./payments/system-locks.js";
import { startPaymentMaintenance } from "./payments/expiry.js";

/**
 * SandboxAdapter com provider renomeado: subclasses de SandboxAdapter não
 * podem redeclarar `provider` (literal "sandbox" na base). Sobrevive ao
 * re-registro de `initAdapters` (que só regrava "sandbox").
 */
class RenamedSandboxAdapter extends SandboxAdapter {
  constructor(providerName: string) {
    super();
    (this as unknown as { provider: string }).provider = providerName;
  }
}

describe("fencing token do lease (revisão v5, itens 1-2)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
    registerAdapter(new SandboxAdapter());
  });

  /** Gateway "fence-*": sobrevive ao re-registro de initAdapters. */
  async function fenceCheckout(provider: string) {
    registerAdapter(new RenamedSandboxAdapter(provider) as unknown as PaymentAdapter);
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider,
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const result = await handleCheckout(
      db,
      { items: [{ variantId: variant.id, quantity: 1 }], address: addr(), paymentMethod: "pix", acceptedTerms: true, ageConfirmed: true } as any,
      { customerId, ip: "127.0.0.1" },
    );
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    await db.update(schema.payments).set({ provider }).where(eq(schema.payments.id, pay.id));
    return { pay, orderId: result.orderId, variant };
  }

  async function insertEvent(provider: string, pay: any, opts: { leaseToken?: string; leaseExpiresAt?: Date | null } = {}) {
    const raw = JSON.stringify({
      id: "fence-1",
      type: "payment.approved",
      data: { transactionId: pay.providerTransactionId },
      // SEM amountCents — valida via gateway (ponto de virada do teste).
    });
    const adapter = getAdapter(provider);
    const parsed = adapter!.parseWebhook(raw);
    const inserted = await db
      .insert(schema.paymentEvents)
      .values({
        provider,
        eventId: parsed.eventId,
        type: "payment.approved",
        payload: JSON.parse(raw),
        signatureValid: true,
        processedAt: null,
        leaseToken: opts.leaseToken ?? null,
        leaseExpiresAt: opts.leaseExpiresAt ?? null,
      })
      .returning();
    return inserted[0]!;
  }

  it("pré-checagem: lease pertence a OUTRO worker → lease_lost, nada é aplicado", async () => {
    const { pay, orderId, variant } = await fenceCheckout("fence-pre");
    const row = await insertEvent("fence-pre", pay, {
      leaseToken: "worker-b",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    const [orderBefore] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    const outcome = await applyPaymentEvent(db, {
      provider: "fence-pre",
      event: getAdapter("fence-pre")!.parseWebhook(JSON.stringify({
        id: "fence-1",
        type: "payment.approved",
        data: { transactionId: pay.providerTransactionId, amountCents: pay.amountCents, currency: "BRL" },
      })),
      payment: pay,
      eventRowId: row.id,
      leaseToken: "worker-a",
      signatureValid: true,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("lease_lost");
    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    expect(payAfter!.status).toBe("pendente");
    const [orderAfter] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(orderAfter!.status).toBe(orderBefore!.status); // aguardando_pagamento
    const [evtAfter] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, row.id));
    expect(evtAfter!.processedAt).toBeNull();
  });

  it("GUARDA na marcação: token trocado durante a aplicação → LeaseLostError, rollback TOTAL", async () => {
    const { pay, orderId, variant } = await fenceCheckout("fence-guard");

    // Evento com lease EXPIRADO do worker-a — legítimo para o ladrão.
    const row = await insertEvent("fence-guard", pay, {
      leaseToken: "worker-a",
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });

    // O ladrão vence o lease expirado e reivindica DURANTE a aplicação do
    // worker-a — no ponto de consulta ao gateway (fora da transação).
    class StealAdapter extends RenamedSandboxAdapter {
      constructor(eventRowId: string) {
        super("fence-guard");
        this.eventRowId = eventRowId;
      }
      private eventRowId: string;
      async queryPayment(providerTransactionId: string): Promise<QueryPaymentResult> {
        await db
          .update(schema.paymentEvents)
          .set({ leaseToken: "worker-b", leaseExpiresAt: new Date(Date.now() + 60_000) })
          .where(eq(schema.paymentEvents.id, this.eventRowId));
        return super.queryPayment(providerTransactionId);
      }
    }
    registerAdapter(new StealAdapter(row.id) as unknown as PaymentAdapter);

    let caught: unknown = null;
    try {
      await applyPaymentEvent(db, {
        provider: "fence-guard",
        event: getAdapter("fence-guard")!.parseWebhook(JSON.stringify({
          id: "fence-1",
          type: "payment.approved",
          data: { transactionId: pay.providerTransactionId },
        })),
        payment: pay,
        eventRowId: row.id,
        leaseToken: "worker-a",
        signatureValid: true,
      });
    } catch (err) {
      caught = err;
    }

    // LeaseLostError ABORTA a transação — o worker antigo não conclui.
    expect(caught).toBeInstanceOf(LeaseLostError);

    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    expect(payAfter!.status).toBe("pendente"); // rollback total
    const [orderAfter] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(orderAfter!.status).toBe("aguardando_pagamento");
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1);
    const [evtAfter] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, row.id));
    expect(evtAfter!.processedAt).toBeNull();
    expect(evtAfter!.leaseToken).toBe("worker-b"); // o dono atual
    // Rollback total: NENHUMA transição de aprovação no histórico
    // (a entrada de criação do pedido é a única permitida).
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(0);
  });

  it("RECOVER: lease perdido durante a aplicação → leaseLost contado, dono atual assume", async () => {
    const { pay, orderId } = await fenceCheckout("fence-recover");
    const row = await insertEvent("fence-recover", pay, {
      leaseToken: "worker-a",
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });

    class StealAdapter extends RenamedSandboxAdapter {
      constructor(eventRowId: string) {
        super("fence-recover");
        this.eventRowId = eventRowId;
      }
      private eventRowId: string;
      async queryPayment(providerTransactionId: string): Promise<QueryPaymentResult> {
        // Simula o OUTRO recoverPendingEvents vencendo o lease expirado:
        // claim atômico grava um token NOVO (não "worker-b" fixo).
        await db
          .update(schema.paymentEvents)
          .set({ leaseToken: `claim-${crypto.randomUUID()}`, leaseExpiresAt: new Date(Date.now() + 120_000) })
          .where(eq(schema.paymentEvents.id, this.eventRowId));
        return super.queryPayment(providerTransactionId);
      }
    }
    registerAdapter(new StealAdapter(row.id) as unknown as PaymentAdapter);

    const summary = await recoverPendingEvents(db, { minBackoffMs: 0 });

    expect(summary.leaseLost).toBe(1);
    expect(summary.applied).toBe(0);
    expect(summary.deadLettered).toBe(0);
    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    expect(payAfter!.status).toBe("pendente");
    const [orderAfter] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(orderAfter!.status).toBe("aguardando_pagamento");
    const [evtAfter] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, row.id));
    expect(evtAfter!.processedAt).toBeNull();
  });

  it("webhook positivo INVALIDA a observação de ausência (nada obsoleto reutilizável)", async () => {
    const { pay, orderId } = await fenceCheckout("fence-inval");
    // Primeira observação `null` já persistida (passada anterior da expiração).
    await db
      .update(schema.payments)
      .set({ notFoundFirstSeenAt: new Date(Date.now() - 30 * 60 * 1000) })
      .where(eq(schema.payments.id, pay.id));

    // Webhook aprovado chega e assenta o pagamento.
    const raw = JSON.stringify({
      id: "inval-1",
      type: "payment.approved",
      data: { transactionId: pay.providerTransactionId, amountCents: pay.amountCents, currency: "BRL" },
    });
    const row = await insertEvent("fence-inval", { ...pay, providerTransactionId: pay.providerTransactionId });
    // insertEvent usa payload SEM amount — sobrescreve com o payload cheio:
    await db.update(schema.paymentEvents).set({ payload: JSON.parse(raw) }).where(eq(schema.paymentEvents.id, row.id));

    const outcome = await applyPaymentEvent(db, {
      provider: "fence-inval",
      event: getAdapter("fence-inval")!.parseWebhook(raw),
      payment: pay,
      eventRowId: row.id,
      signatureValid: true,
    });
    expect(outcome.applied).toBe(true);

    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    expect(payAfter!.status).toBe("aprovado");
    expect(payAfter!.notFoundFirstSeenAt).toBeNull(); // observação invalidada
    void orderId;
  });

  it("CLAIM único: cada reivindicação gera um token DIFERENTE (capturado e comparado)", async () => {
    const { pay } = await fenceCheckout("fence-token");
    const row1 = await insertEvent("fence-token", pay, { leaseExpiresAt: null });

    // 1º claim: recovery aplica e conclui — token gravado na linha.
    await recoverPendingEvents(db, { minBackoffMs: 0, maxAttempts: 1, maxAgeDays: 30 });
    const [evt1] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, row1.id));
    const token1 = evt1!.leaseToken;

    // Evento novo para 2º claim sobre o MESMO caminho.
    const raw = JSON.stringify({ id: "fence-2", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    const parsed = (getAdapter("fence-token") as PaymentAdapter)!.parseWebhook(raw);
    await db.insert(schema.paymentEvents).values({
      provider: "fence-token",
      eventId: parsed.eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });
    const second = await recoverPendingEvents(db, { minBackoffMs: 0, maxAttempts: 1, maxAgeDays: 30 });
    const [evt2] = await db.select().from(schema.paymentEvents).where(and(eq(schema.paymentEvents.provider, "fence-token"), eq(schema.paymentEvents.eventId, parsed.eventId)));
    const token2 = evt2!.leaseToken;

    // UNICIDADE comprovada: os dois claims escreveram tokens PRÓPRIOS —
    // não nulos e diferentes (reuso de token entre claims = defeito de fencing).
    expect(token1).toBeTruthy();
    expect(token2).toBeTruthy();
    expect(token1).not.toBe(token2);

    // A guarda NÃO bloqueia o dono legítimo: ambos concluídos com claims
    // próprios (tokens gerados por reivindicação, não reutilizados).
    expect(second.applied).toBe(1);
    expect(evt1!.processedAt).toBeTruthy();
    expect(evt2!.processedAt).toBeTruthy();
  });
});

describe("lease de manutenção multi-instância (revisão v5, item 3)", () => {
  beforeEach(async () => {
    await clearTables();
    await db.execute(`DELETE FROM "system_locks"`).catch(() => {});
    await db.execute(`INSERT INTO "system_locks" ("name") VALUES ('payment_maintenance') ON CONFLICT DO NOTHING`);
  });

  it("aquisição atômica: 2ª instância NÃO adquire lock vigente", async () => {
    const t1 = await acquireSystemLock(db, "test-lock", 60_000);
    expect(t1).toBeTruthy();
    const t2 = await acquireSystemLock(db, "test-lock", 60_000);
    expect(t2).toBeNull();
  });

  it("expiração: lease vencido devolve o lock à próxima instância", async () => {
    const t1 = await acquireSystemLock(db, "test-lock", 30);
    expect(t1).toBeTruthy();
    await new Promise((r) => setTimeout(r, 60));
    const t2 = await acquireSystemLock(db, "test-lock", 60_000);
    expect(t2).toBeTruthy();
    expect(t2).not.toBe(t1);
  });

  it("renovação SOMENTE pelo dono; release por não-dono é no-op", async () => {
    const owner = await acquireSystemLock(db, "test-lock", 60_000);
    expect(await renewSystemLock(db, "test-lock", owner!, 60_000)).toBe(true);
    expect(await renewSystemLock(db, "test-lock", "intruso", 60_000)).toBe(false);
    expect(await releaseSystemLock(db, "test-lock", "intruso")).toBe(false);
    // Dono não perdeu a posse com a tentativa de intruso.
    expect(await renewSystemLock(db, "test-lock", owner!, 60_000)).toBe(true);
    expect(await releaseSystemLock(db, "test-lock", owner!)).toBe(true);
    // Liberado: próxima aquisição obtém novo token.
    const next = await acquireSystemLock(db, "test-lock", 60_000);
    expect(next).toBeTruthy();
  });

  it("withSystemLock em contenção: UMA execução, 2ª instância pula a passada", async () => {
    let running = 0;
    let maxConcurrent = 0;
    const job = async (ms: number) =>
      withSystemLock(db, "contention-lock", 60_000, async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((r) => setTimeout(r, ms));
        running--;
        return "done";
      });

    const [r1, r2] = await Promise.all([job(50), job(50)]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false); // pulou: 1ª detém o lease
    expect(maxConcurrent).toBe(1);
  });

  it("PERDA de lock confirmada pelo heartbeat → ctx.lost() sinaliza aborto cooperativo", async () => {
    // ttl curto: o lease expira durante a execução e OUTRA instância toma.
    const first = withSystemLock(db, "lost-lock", 50, async (ctx) => {
      await new Promise((r) => setTimeout(r, 1_400)); // heartbeat em ~1s: renovação recusada
      return { sawLost: ctx.lost() };
    });
    await new Promise((r) => setTimeout(r, 150)); // lease expira; ladrão toma
    const thief = await acquireSystemLock(db, "lost-lock", 60_000);
    expect(thief).toBeTruthy();
    const r1 = await first;
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.value.sawLost).toBe(true); // heartbeat confirmou a perda
    }
  });

  it("startPaymentMaintenance com 2 instâncias: passadas NUNCA se sobrepõem", async () => {
    let active = 0;
    let maxConcurrent = 0;
    let passes = 0;
    const runOnce = async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((r) => setTimeout(r, 20));
      passes++;
      active--;
    };    const a = startPaymentMaintenance(db, runOnce, { intervalMs: 30, lockTtlMs: 60_000, lockName: "maintenance-itest" });
    const b = startPaymentMaintenance(db, runOnce, { intervalMs: 30, lockTtlMs: 60_000, lockName: "maintenance-itest" });
    await new Promise((r) => setTimeout(r, 250));
    a.stop();
    b.stop();
    await db.execute(`DELETE FROM "system_locks" WHERE "name" = 'maintenance-itest'`);
    expect(passes).toBeGreaterThanOrEqual(1);
    expect(maxConcurrent).toBe(1); // exclusão entre INSTÂNCIAS no banco
  });
});

describe("atomicidade da expiração e corrida com webhook (revisão v5, item 5)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
    registerAdapter(new SandboxAdapter());
  });

  /** Pedido antigo com pagamento pendente, provider trocado — alvo da expiração. */
  async function staleOrder(provider: string, variantId: string, customerId: string) {
    registerAdapter(new SandboxAdapter());
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider,
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const created = await handleCheckout(
      db,
      { items: [{ variantId, quantity: 1 }], address: addr(), paymentMethod: "pix", acceptedTerms: true, ageConfirmed: true } as any,
      { customerId, ip: "127.0.0.1" },
    );
    await db.update(schema.orders).set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }).where(eq(schema.orders.id, created.orderId));
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, created.orderId));
    await db.update(schema.payments).set({ provider }).where(eq(schema.payments.id, pay.id));
    return created.orderId;
  }

  /** Adapter aprovado: cobrança confirmada no provedor. */
  class ApprovedExpiryAdapter extends RenamedSandboxAdapter {
    constructor(providerName: string) {
      super(providerName);
    }
    async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
      return { status: "aprovado", amountCents: 10000, currency: "BRL" };
    }
  }

  it("WEBHOOK × EXPIRAÇÃO em paralelo: UMA aprovação de pedido, sem estado parcial", async () => {
    const provider = "race-we";
    registerAdapter(new ApprovedExpiryAdapter(provider) as unknown as PaymentAdapter);
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const orderId = await staleOrder(provider, variant.id, customerId);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));

    // Webhook approved (evento persistido) corre com a expiração que
    // consultou o MESMO pagamento aprovado no provedor.
    const raw = JSON.stringify({ id: "race-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId, amountCents: pay.amountCents, currency: "BRL" } });
    const parsed = getAdapter(provider)!.parseWebhook(raw);
    const [evt] = await db
      .insert(schema.paymentEvents)
      .values({ provider, eventId: parsed.eventId, type: "payment.approved", payload: JSON.parse(raw), signatureValid: true })
      .returning();

    const webhook = applyPaymentEvent(db, {
      provider,
      event: parsed,
      payment: pay,
      eventRowId: evt.id,
      leaseToken: undefined,
      signatureValid: true,
    });
    const [expiryResult, webhookOutcome] = await Promise.all([
      expireStaleReservations(db, { olderThanMinutes: 60 }),
      webhook,
    ]);

    // Independente da ordem: o pedido vira pagamento_aprovado EXATAMENTE
    // uma vez — sem dupla transição, sem estoque liberado em cancelamento.
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(1);
    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    expect(payAfter!.status).toBe("aprovado");
    expect(expiryResult.cancelled).toBe(0);
    // As duas vias convergem: quem perdeu a corrida registra skip/no-op.
    expect(expiryResult.approved + (webhookOutcome.applied ? 1 : 0)).toBeGreaterThanOrEqual(1);
    // Auditoria de expiração só quando A expiração transicionou.
    const confirmAudits = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.entityId, orderId), eq(schema.auditLogs.action, "expiry.late_confirmation")));
    if (expiryResult.approved === 1) expect(confirmAudits.length).toBe(1);
    else expect(confirmAudits.length).toBe(0);
  });

  it("FALHA transacional na expiração: rollback TOTAL — nada parcial (estoque, histórico, auditoria)", async () => {
    const provider = "fail-exp";
    registerAdapter(new ApprovedExpiryAdapter(provider) as unknown as PaymentAdapter);
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const orderId = await staleOrder(provider, variant.id, customerId);

    // Gatilho determinístico de falha: captura é proibida enquanto a
    // constraint existe — o update do pagamento explode DENTRO da
    // transação de finalizeExpiry.
    await db.execute(`ALTER TABLE "payments" ADD CONSTRAINT test_forbid_capture CHECK ("captured_at" IS NULL) NOT VALID`);
    try {
      let threw: unknown = null;
      try {
        await expireStaleReservations(db, { olderThanMinutes: 60 });
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeTruthy(); // finalizeExpiry falhou e o erro subiu
      // Sem atualização parcial: pedido, pagamento, histórico, estoque e
      // auditoria permanecem no estado anterior.
      const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
      expect(order!.status).toBe("aguardando_pagamento");
      const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
      expect(payAfter!.status).toBe("pendente");
      expect(payAfter!.capturedAt).toBeNull();
      // Rollback total: NENHUMA transição de aprovação/cancelamento além da
      // entrada de criação do pedido.
      const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
      expect(history.filter((h: any) => h.toStatus !== "aguardando_pagamento").length).toBe(0);
      const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
      expect(inv.reserved).toBe(1);
      const lateAudits = await db
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.action, "expiry.late_confirmation"), eq(schema.auditLogs.entityId, orderId)));
      expect(lateAudits.length).toBe(0);
    } finally {
      await db.execute(`ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS test_forbid_capture`);
    }
  });

  it("FENCING × EXPIRAÇÃO em paralelo: ladrão assume o lease; webhook aborta; expiração assenta UMA vez", async () => {
    const provider = "fence-race";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    registerAdapter(new ApprovedExpiryAdapter(provider) as unknown as PaymentAdapter);
    const orderId = await staleOrder(provider, variant.id, customerId);
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));

    // Evento reivindicado por worker-a (lease vigente), sem amountCents —
    // validação passa pelo gateway (ponto de virada do ladrão).
    const raw = JSON.stringify({ id: "fence-race-1", type: "payment.approved", data: { transactionId: pay.providerTransactionId } });
    const parsed = getAdapter(provider)!.parseWebhook(raw);
    const [evt] = await db
      .insert(schema.paymentEvents)
      .values({
        provider,
        eventId: parsed.eventId,
        type: "payment.approved",
        payload: JSON.parse(raw),
        signatureValid: true,
        leaseToken: "worker-a",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    class StealRaceAdapter extends RenamedSandboxAdapter {
      constructor() {
        super(provider);
      }
      async queryPayment(providerTransactionId: string): Promise<QueryPaymentResult> {
        await db
          .update(schema.paymentEvents)
          .set({ leaseToken: "worker-b", leaseExpiresAt: new Date(Date.now() + 60_000) })
          .where(eq(schema.paymentEvents.id, evt.id));
        return super.queryPayment(providerTransactionId);
      }
      async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
        return { status: "aprovado", amountCents: 10000, currency: "BRL" };
      }
    }
    registerAdapter(new StealRaceAdapter() as unknown as PaymentAdapter);

    const webhook = applyPaymentEvent(db, {
      provider,
      event: parsed,
      payment: pay,
      eventRowId: evt.id,
      leaseToken: "worker-a",
      signatureValid: true,
    }).catch((err) => err); // LeaseLostError propaga no caminho direto

    const [expiryResult, webhookOutcome] = await Promise.all([
      expireStaleReservations(db, { olderThanMinutes: 60 }),
      webhook,
    ]);

    // Webhook aborta: o worker antigo não conclui o evento que perdeu.
    expect(webhookOutcome).toBeInstanceOf(LeaseLostError);

    // Expiração assenta: UMA transição de aprovação, pagamento aprovado.
    expect(expiryResult.approved).toBe(1);
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("pagamento_aprovado");
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(1);
    const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    expect(payAfter!.status).toBe("aprovado");

    // Evento NÃO concluído pelo worker antigo — fica para o dono atual
    // (passada seguinte marca como already_applied).
    const [evtAfter] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, evt.id));
    expect(evtAfter!.processedAt).toBeNull();
    expect(evtAfter!.leaseToken).toBe("worker-b");
  });
});

// ---------------------------------------------------------------------------
// Correção pós-revisão (v5.1) — decisão de expiração DEFINIDA PELO ESTADO DO
// PEDIDO (finalizeExpiry). Contrato exigido pela revisão:
//   1. Pagamento aprovado NUNCA é confirmado com pedido cancelado sem
//      registro durável de refund_required.
//   2. Transição obrigatória recusada ⇒ NADA é assentado (pagamento fica
//      pendente) — e a recusa não mata a passada de manutenção.
//   3. Reconciliação (pedido já no alvo) NUNCA audita late_confirmation
//      como se a transição tivesse ocorrido.
// ---------------------------------------------------------------------------

describe("finalizeExpiry: decisão por estado do pedido (correção pós-revisão)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
    registerAdapter(new SandboxAdapter());
  });

  async function staleOrderFor(provider: string, variantId: string, customerId: string) {
    // Adapter do provider registrado ANTES do checkout (o checkout resolve
    // o gateway pelo provider da config habilitada).
    registerAdapter(new RenamedSandboxAdapter(provider) as unknown as PaymentAdapter);
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider,
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const created = await handleCheckout(
      db,
      { items: [{ variantId, quantity: 1 }], address: addr(), paymentMethod: "pix", acceptedTerms: true, ageConfirmed: true } as any,
      { customerId, ip: "127.0.0.1" },
    );
    await db.update(schema.orders).set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }).where(eq(schema.orders.id, created.orderId));
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, created.orderId));
    await db.update(schema.payments).set({ provider }).where(eq(schema.payments.id, pay.id));
    return { orderId: created.orderId, paymentId: pay.id };
  }

  /** Adapter aprovado que vira o estado do pedido na consulta ao gateway —
   *  simula mutação (admin/webhook) na janela entre scan e decisão. */
  class FlipOrderAdapter extends RenamedSandboxAdapter {
    constructor(providerName: string, private orderId: string, private to: string) {
      super(providerName);
    }
    async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
      await db.update(schema.orders).set({ status: this.to as any }).where(eq(schema.orders.id, this.orderId));
      return { status: "aprovado", amountCents: 10000, currency: "BRL" };
    }
  }

  it("PEDIDO INEXISTENTE: NADA é assentado — divergência financeira tratável, nunca reconciliação automática", async () => {
    const provider = "miss-exp";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const { orderId, paymentId } = await staleOrderFor(provider, variant.id, customerId);
    let fkName: string | null = null;

    // Cirurgia determinística: pagamento sobrevive, pedido desaparece (só
    // possível com a FK temporariamente removida — estado legado/cirúrgico;
    // em produção a FK payments→orders impede esse estado por operação normal).
    // Nome da constraint descoberto dinamicamente (baseline SQL usa _fkey).
    class DeleteOrderAdapter extends RenamedSandboxAdapter {
      constructor() {
        super(provider);
      }
      async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
        const cons = await db.execute(
          `SELECT conname FROM pg_constraint WHERE conrelid = 'payments'::regclass AND contype = 'f' AND confrelid = 'orders'::regclass`,
        );
        fkName = ((cons as any).rows?.[0]?.conname ?? null) as string | null;
        if (fkName) await db.execute(`ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "${fkName}"`);
        await db.execute(`DELETE FROM "orders" WHERE "id" = '${orderId}'`);
        return { status: "aprovado", amountCents: 10000, currency: "BRL" };
      }
    }
    registerAdapter(new DeleteOrderAdapter() as unknown as PaymentAdapter);

    let threw: unknown = null;
    let summary: Awaited<ReturnType<typeof expireStaleReservations>> | undefined;
    try {
      summary = await expireStaleReservations(db, { olderThanMinutes: 60 });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull();

    // Pagamento NÃO é assentado — dinheiro sem pedido é divergência a
    // tratar por humano, não "reconciliação" automática.
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(payment!.status).toBe("pendente");
    expect(payment!.capturedAt).toBeNull();

    // Divergência registrada como TRATÁVEL (âncora no pagamento — o id do
    // pedido não existe mais).
    const missing = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.skipped_order_missing"), eq(schema.auditLogs.entityId, paymentId)));
    expect(missing.length).toBe(1);
    expect(JSON.stringify(missing[0]!.afterJson)).toContain(orderId);
    expect((summary as any)?.skippedOrderMissing).toBe(1);

    // NUNCA reconcilia automaticamente (auditoria antiga classificava como
    // reconciliação normal — defeito).
    const recon = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.payment_reconciled"), eq(schema.auditLogs.entityId, orderId)));
    expect(recon.length).toBe(0);

    // Restauração do schema: remove o pagamento órfão e devolve a FK.
    await db.execute(`DELETE FROM "payments" WHERE "id" = '${paymentId}'`);
    if (fkName) await db.execute(`ALTER TABLE "payments" ADD CONSTRAINT "${fkName}" FOREIGN KEY ("order_id") REFERENCES "orders"("id")`);
  });

  it("PEDIDO CANCELADO + provedor aprovado: pagamento tardio assentado com refund_required DURÁVEL — sem reabrir pedido, sem matar a passada", async () => {
    const provider = "late-exp";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const { orderId } = await staleOrderFor(provider, variant.id, customerId);
    // O pedido é cancelado DURANTE a passada (janela entre scan e decisão):
    // o gancho do adapter vira o estado antes de devolver "aprovado".
    registerAdapter(new FlipOrderAdapter(provider, orderId, "cancelado") as unknown as PaymentAdapter);

    let threw: unknown = null;
    let summary: Awaited<ReturnType<typeof expireStaleReservations>> | undefined;
    try {
      summary = await expireStaleReservations(db, { olderThanMinutes: 60 });
    } catch (err) {
      threw = err;
    }

    // A passada SOBREVIVE: recusa/derivação de transição não é exceção
    // não-tratada (estado "veneno" não derruba o varrimento inteiro).
    expect(threw).toBeNull();

    // Dinheiro entrou: realidade financeira registrada no pagamento.
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(payment!.status).toBe("aprovado");
    expect(payment!.capturedAt).toBeTruthy();

    // Pedido NÃO reabre.
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("cancelado");

    // Sem transição de aprovação no histórico (pedido cancelado não transiciona).
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(0);

    // Registro DURÁVEL de refund_required (order.late_payment, na transação).
    const late = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "order.late_payment"), eq(schema.auditLogs.entityId, orderId)));
    expect(late.length).toBe(1);
    expect(JSON.stringify(late[0]!.afterJson)).toContain("refund_required");

    // NUNCA audita late_confirmation como se tivesse transicionado.
    const lateConf = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.late_confirmation"), eq(schema.auditLogs.entityId, orderId)));
    expect(lateConf.length).toBe(0);

    // Estoque não é tocado pela expiração (pedido já estava cancelado sem transição).
    const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv.reserved).toBe(1);

    // Contador do summary registra o pagamento tardio.
    expect((summary as any)?.latePayment).toBe(1);
  });

  it("PEDIDO JÁ NO ALVO: pagamento reconciliado SEM auditoria de confirmação tardia", async () => {
    const provider = "recon-exp";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const { orderId } = await staleOrderFor(provider, variant.id, customerId);
    // Pedido já em pagamento_aprovado na janela do scan→decisão (divergência
    // legada): reconciliação, não transição.
    registerAdapter(new FlipOrderAdapter(provider, orderId, "pagamento_aprovado") as unknown as PaymentAdapter);

    let threw: unknown = null;
    let summary: Awaited<ReturnType<typeof expireStaleReservations>> | undefined;
    try {
      summary = await expireStaleReservations(db, { olderThanMinutes: 60 });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull();

    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(payment!.status).toBe("aprovado");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("pagamento_aprovado");

    // Sem transição (from === to): NENHUMA entrada nova no histórico.
    const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
    expect(history.filter((h: any) => h.toStatus === "pagamento_aprovado").length).toBe(0);

    // NÃO audita late_confirmation (transição não ocorreu).
    const lateConf = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.late_confirmation"), eq(schema.auditLogs.entityId, orderId)));
    expect(lateConf.length).toBe(0);

    // Audita a RECONCILIAÇÃO, com o estado real do pedido.
    const recon = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.payment_reconciled"), eq(schema.auditLogs.entityId, orderId)));
    expect(recon.length).toBe(1);

    expect((summary as any)?.approved).toBe(0);
    expect((summary as any)?.latePayment).toBe(0);
  });

  it("TRANSIÇÃO recusada (estado não-transicionável): NADA é assentado — pagamento permanece pendente", async () => {
    const provider = "refuse-exp";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const { orderId } = await staleOrderFor(provider, variant.id, customerId);
    // Pedido enviado na janela scan→decisão: nenhum estado de pagamento
    // transiciona a partir daqui — assentamento automático é proibido.
    registerAdapter(new FlipOrderAdapter(provider, orderId, "enviado") as unknown as PaymentAdapter);

    let threw: unknown = null;
    let summary: Awaited<ReturnType<typeof expireStaleReservations>> | undefined;
    try {
      summary = await expireStaleReservations(db, { olderThanMinutes: 60 });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull(); // recusa não derruba a passada

    // Pagamento NÃO é assentado — investigação humana decide.
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
    expect(payment!.status).toBe("pendente");
    expect(payment!.capturedAt).toBeNull();
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order!.status).toBe("enviado");

    // Auditoria OPERACIONAL da recusa (fora da transação — não houve mutação).
    const skipAudit = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, "expiry.skipped_invalid_order_state"), eq(schema.auditLogs.entityId, orderId)));
    expect(skipAudit.length).toBe(1);
    expect((summary as any)?.approved).toBe(0);
    expect((summary as any)?.latePayment).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Correção pós-revisão (v5.2) — heartbeats: INCERTEZA não pode durar para
// sempre. Sem renovação CONFIRMADA por ≥ TTL, ctx.lost() vira true — mesmo
// sem nenhuma recusa (banco silencioso não mantém o worker no lock).
// ---------------------------------------------------------------------------

describe("withSystemLock: incerteza do heartbeat (correção pós-revisão)", () => {
  beforeEach(async () => {
    await clearTables();
    await db.execute(`DELETE FROM "system_locks"`).catch(() => {});
    await db.execute(`INSERT INTO "system_locks" ("name") VALUES ('payment_maintenance') ON CONFLICT DO NOTHING`);
  });

  it("INCERTEZA prolongada: sem renovação confirmada por ≥ TTL ⇒ ctx.lost() true — mesmo sem recusa", async () => {
    // TTL 50 ms: o 1º heartbeat só rodaria aos 1 s — entre a aquisição e lá
    // NENHUMA renovação é confirmada. A margem de segurança (TTL) vence: o
    // lease no banco já expirou; outra instância PODE ter assumido.
    const r = await withSystemLock(db, "uncertain-lock", 50, async (ctx) => {
      await new Promise((res) => setTimeout(res, 300));
      return { sawLost: ctx.lost() };
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sawLost).toBe(true);
  });

  it("dentro da margem (renovação confirmada recentemente): ctx.lost() permanece false", async () => {
    const r = await withSystemLock(db, "certain-lock", 60_000, async (ctx) => {
      await new Promise((res) => setTimeout(res, 100));
      return { sawLost: ctx.lost() };
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sawLost).toBe(false);
  });

  it("EXCEÇÃO real na renovação (banco indisponível): incerteza além da margem ⇒ fases 2-3 NÃO rodam", async () => {
    // Falha de rede REAL: a tabela do lease desaparece — TODA renovação do
    // heartbeat LANÇA erro (engolido = incerteza). TTL 3000 ms com heartbeat
    // aos ~1000/2000/3000 ms: três exceções, ZERO recusas, ZERO confirmações.
    // A margem vence (nenhuma confirmação desde a aquisição) e o worker
    // NÃO executa as fases seguintes.
    const phases: string[] = [];
    try {
      const r = await withSystemLock(db, "phase-net-fail", 3_000, async (ctx) => {
        phases.push("fase-1:recuperacao");
        await db.execute(`ALTER TABLE "system_locks" RENAME TO "system_locks_bak"`);
        await new Promise((res) => setTimeout(res, 3_200));
        if (!ctx.lost()) phases.push("fase-2:reparo");
        if (!ctx.lost()) phases.push("fase-3:expiracao");
        return phases;
      });
      expect(r.ok).toBe(true);
    } finally {
      await db.execute(`ALTER TABLE "system_locks_bak" RENAME TO "system_locks"`).catch(() => {});
    }
    expect(phases).toEqual(["fase-1:recuperacao"]);
  });

  it("RECUPERAÇÃO: falha transitória + renovação CONFIRMADA antes do limite ⇒ lock mantido, fases continuam", async () => {
    // O banco volta ANTES da margem (3000 ms): a linha do lease sobrevive
    // intacta ao RENAME. Heartbeat aos ~1000 ms falha (incerteza); aos
    // ~2000 ms RENOVA com sucesso — a margem rearma e o lock NÃO é perdido
    // indevidamente: fases 2-3 executam normalmente.
    const phases: string[] = [];
    try {
      const r = await withSystemLock(db, "phase-net-recover", 3_000, async (ctx) => {
        phases.push("fase-1:recuperacao");
        await db.execute(`ALTER TABLE "system_locks" RENAME TO "system_locks_bak"`);
        await new Promise((res) => setTimeout(res, 1_500));
        await db.execute(`ALTER TABLE "system_locks_bak" RENAME TO "system_locks"`);
        await new Promise((res) => setTimeout(res, 900)); // checagem em ~2400 ms, margem rearmada aos ~2000 ms
        if (!ctx.lost()) phases.push("fase-2:reparo");
        if (!ctx.lost()) phases.push("fase-3:expiracao");
        return phases;
      });
      expect(r.ok).toBe(true);
    } finally {
      await db.execute(`ALTER TABLE "system_locks_bak" RENAME TO "system_locks"`).catch(() => {});
    }
    expect(phases).toEqual(["fase-1:recuperacao", "fase-2:reparo", "fase-3:expiracao"]);
  });
});

// ---------------------------------------------------------------------------
// Correção pós-revisão (v5.3) — migrations: DDL obrigatório NÃO pode ser
// engolido. Falha real de DDL rejeita o migrate (boot interrompido);
// idempotência continua valendo (reexecução é no-op, não erro).
// ---------------------------------------------------------------------------

describe("migrate: DDL obrigatório propaga falha (correção pós-revisão)", () => {
  it("FALHA de DDL obrigatório rejeita o migrate — silêncio não é sucesso", async () => {
    let rejected = false;
    // DROP COLUMN dentro de transação: rollback SEMPRE restaura o schema.
    await db
      .transaction(async (tx: Db) => {
        await tx.execute(`ALTER TABLE "payment_events" DROP COLUMN "processed_at"`);
        try {
          await migrate(tx as unknown as Db);
          rejected = false; // migrate ENGOLIU a falha obrigatória (defeito)
        } catch {
          rejected = true; // migrate PROPAGOU (comportamento exigido)
        }
        throw new Error("rollback sempre — restaura processed_at");
      })
      .catch(() => {});
    expect(rejected).toBe(true);

    // A coluna voltou (rollback da transação).
    const cols = await db.execute(`SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_events' AND column_name = 'processed_at'`);
    expect((cols as any).rows?.length ?? 0).toBe(1);
  });

  it("IDEMPOTÊNCIA preservada: migrate reexecutado é no-op (sem erro)", async () => {
    await expect(migrate(db as unknown as Db)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Correção pós-revisão (v5.4) — dead-letter: token informado exige
// correspondência EXATA com o persistido, inclusive quando o persistido é
// NULL. Três estados no comparador: dono legítimo marca; divergência e
// ausência de token persistido BLOQUEIAM.
// ---------------------------------------------------------------------------

describe("deadLetter: guarda estrita de token (correção pós-revisão)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
    registerAdapter(new SandboxAdapter());
  });

  it("token persistido NULL + token informado: dead-letter BLOQUEADA (evento permanece na fila)", async () => {
    const provider = "dl-strict";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    registerAdapter(new RenamedSandboxAdapter(provider) as unknown as PaymentAdapter);
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider,
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const result = await handleCheckout(
      db,
      { items: [{ variantId: variant.id, quantity: 1 }], address: addr(), paymentMethod: "pix", acceptedTerms: true, ageConfirmed: true } as any,
      { customerId, ip: "127.0.0.1" },
    );
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    await db.update(schema.payments).set({ provider }).where(eq(schema.payments.id, pay.id));

    // Adapter ladrão: limpa o token persistido no meio do processamento e
    // devolve valor divergente ao gateway ⇒ amount_mismatch ⇒ max_attempts
    // (1) ⇒ dead-letter com o token do claim — contra persistido NULL.
    class ClearTokenAdapter extends RenamedSandboxAdapter {
      constructor(providerName: string) {
        super(providerName);
      }
      async queryPayment(providerTransactionId: string): Promise<QueryPaymentResult> {
        await db.execute(`UPDATE "payment_events" SET "lease_token" = NULL WHERE "provider" = 'dl-strict' AND "processed_at" IS NULL`);
        return { status: "pendente", amountCents: 1, currency: "BRL" };
      }
      async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
        return null;
      }
    }
    registerAdapter(new ClearTokenAdapter(provider) as unknown as PaymentAdapter);

    // Evento SEM amountCents: validação passa pelo gateway (gancho acima).
    const raw = JSON.stringify({
      id: "dl-strict-1",
      type: "payment.approved",
      data: { transactionId: pay.providerTransactionId },
    });
    const parsed = (getAdapter(provider) as PaymentAdapter)!.parseWebhook(raw);
    await db.insert(schema.paymentEvents).values({
      provider,
      eventId: parsed.eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });

    const summary = await recoverPendingEvents(db, { minBackoffMs: 0, maxAttempts: 1, maxAgeDays: 30 });

    // Guarda estrita: token persistido NULL ≠ token do claim ⇒ NÃO marca.
    expect(summary.deadLettered).toBe(0);
    const [row] = await db
      .select()
      .from(schema.paymentEvents)
      .where(and(eq(schema.paymentEvents.provider, provider), eq(schema.paymentEvents.eventId, parsed.eventId)));
    expect(row!.deadLetter).toBe(false);
    expect(row!.processedAt).toBeNull();
    expect(summary.rejected).toBe(1);
  });

  it("token persistido DIVERGENTE preenchido (worker-b ≠ worker-a): dead-letter BLOQUEADA (evento permanece na fila)", async () => {
    // Espelho do caso NULL: aqui o evento TEM um lease_token persistido, mas
    // de OUTRO worker. A guarda exige correspondência exata — token
    // preenchido e diferente não é menos bloqueante que NULL.
    const provider = "dl-swap";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    registerAdapter(new RenamedSandboxAdapter(provider) as unknown as PaymentAdapter);
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider,
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const result = await handleCheckout(
      db,
      { items: [{ variantId: variant.id, quantity: 1 }], address: addr(), paymentMethod: "pix", acceptedTerms: true, ageConfirmed: true } as any,
      { customerId, ip: "127.0.0.1" },
    );
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, result.orderId));
    await db.update(schema.payments).set({ provider }).where(eq(schema.payments.id, pay.id));

    // Adapter ladrão: sobrescreve o token persistido com o de OUTRO worker
    // e devolve valor divergente ao gateway ⇒ amount_mismatch ⇒ max_attempts
    // (1) ⇒ dead-letter com o token do claim — contra persistido 'worker-b'.
    class SwapTokenAdapter extends RenamedSandboxAdapter {
      constructor(providerName: string) {
        super(providerName);
      }
      async queryPayment(providerTransactionId: string): Promise<QueryPaymentResult> {
        await db.execute(`UPDATE "payment_events" SET "lease_token" = 'worker-b' WHERE "provider" = 'dl-swap' AND "processed_at" IS NULL`);
        return { status: "pendente", amountCents: 1, currency: "BRL" };
      }
      async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
        return null;
      }
    }
    registerAdapter(new SwapTokenAdapter(provider) as unknown as PaymentAdapter);

    const raw = JSON.stringify({
      id: "dl-swap-1",
      type: "payment.approved",
      data: { transactionId: pay.providerTransactionId },
    });
    const parsed = (getAdapter(provider) as PaymentAdapter)!.parseWebhook(raw);
    await db.insert(schema.paymentEvents).values({
      provider,
      eventId: parsed.eventId,
      type: "payment.approved",
      payload: JSON.parse(raw),
      signatureValid: true,
      processedAt: null,
    });

    const summary = await recoverPendingEvents(db, { minBackoffMs: 0, maxAttempts: 1, maxAgeDays: 30 });

    // Guarda estrita: token persistido 'worker-b' ≠ token do claim ⇒ NÃO marca.
    const [row] = await db
      .select()
      .from(schema.paymentEvents)
      .where(and(eq(schema.paymentEvents.provider, provider), eq(schema.paymentEvents.eventId, parsed.eventId)));
    expect(row!.leaseToken).toBe("worker-b"); // a troca REALMENTE aconteceu
    expect(summary.deadLettered).toBe(0);
    expect(row!.deadLetter).toBe(false);
    expect(row!.processedAt).toBeNull();
    expect(summary.rejected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Evidência pós-revisão 2/3 — heartbeat: DETECTAR a perda não basta; a
// PRÓXIMA FASE da manutenção não pode executar. Os testes reproduzem o
// contrato de runMaintenance (index.ts): fases encadeadas com `lost()` checado
// ENTRE elas — recusa confirmada da renovação (ladrão real) e incerteza
// prolongada (margem TTL) bloqueiam as fases seguintes.
// ---------------------------------------------------------------------------

describe("heartbeat: bloqueio da PRÓXIMA fase (evidência pós-revisão)", () => {
  beforeEach(async () => {
    await clearTables();
    await db.execute(`DELETE FROM "system_locks"`).catch(() => {});
    await db.execute(`INSERT INTO "system_locks" ("name") VALUES ('payment_maintenance') ON CONFLICT DO NOTHING`);
  });

  it("RECUSA confirmada (lease tomado por outra instância): fase 1 roda, fases 2-3 NÃO rodam", async () => {
    // TTL 3000 ms: heartbeat a cada 1000 ms; a margem de segurança (3000 ms)
    // NÃO vence antes do heartbeat — a perda só pode vir da RECUSA da
    // renovação (token na linha não é mais o nosso).
    const phases: string[] = [];
    let renewalRecused: boolean | null = null;

    const r = await withSystemLock(db, "phase-abort-steal", 3_000, async (ctx) => {
      phases.push("fase-1:recuperacao");
      if (ctx.lost()) return phases;

      // Outra instância assumiu o lease (após vencimento — representado pela
      // troca do token na linha, mesmo mecanismo dos adapters ladrões):
      // a partir daqui a renovação do dono antigo é RECUSADA.
      await db
        .update(schema.systemLocks)
        .set({ leaseToken: "instancia-b", leaseExpiresAt: new Date(Date.now() + 60_000) })
        .where(eq(schema.systemLocks.name, "phase-abort-steal"));

      // Esperar o heartbeat do dono antigo (aos ~1000 ms): renovação RECUSADA.
      await new Promise((res) => setTimeout(res, 1_300));

      renewalRecused = !(await renewSystemLock(db, "phase-abort-steal", "token-do-dono-antigo", 3_000));
      if (!ctx.lost()) phases.push("fase-2:reparo");
      if (!ctx.lost()) phases.push("fase-3:expiracao");
      return phases;
    });

    // A recusa é real: o token antigo não renova mais.
    expect(renewalRecused).toBe(true);
    // O dono antigo percebeu a perda e ABORTOU: nenhuma fase além da 1ª —
    // e a decisão NÃO veio da margem (TTL 3000 ms > tempo decorrido ~1300 ms).
    expect(r.ok).toBe(true);
    expect(phases).toEqual(["fase-1:recuperacao"]);
  });

  it("INCERTEZA prolongada além da margem (sem ladrão): fase 1 roda, fases 2-3 NÃO rodam", async () => {
    // TTL 50 ms: o 1º heartbeat só rodaria aos 1000 ms — entre aquisição e
    // lá NENHUMA renovação é confirmada. A margem vence: lost() true.
    const phases: string[] = [];
    const r = await withSystemLock(db, "phase-abort-margin", 50, async (ctx) => {
      phases.push("fase-1:recuperacao");
      await new Promise((res) => setTimeout(res, 300));
      if (!ctx.lost()) phases.push("fase-2:reparo");
      if (!ctx.lost()) phases.push("fase-3:expiracao");
      return phases;
    });
    expect(r.ok).toBe(true);
    expect(phases).toEqual(["fase-1:recuperacao"]);
  });
});

// ---------------------------------------------------------------------------
// Evidência pós-revisão 3/3 — auditoria transacional: falha ESPECÍFICA no
// INSERT da auditoria (depois da mutação financeira) reverte TUDO — pagamento,
// pedido, estoque, histórico, marcação do evento. Gatilho determinístico no
// banco: BEFORE INSERT em audit_logs RAISE EXCEPTION para a ação alvo.
// ---------------------------------------------------------------------------

describe("atomicidade da auditoria: falha no INSERT reverte a mutação (evidência pós-revisão)", () => {
  beforeEach(async () => {
    await clearTables();
    resetSandboxCharges();
    registerAdapter(new SandboxAdapter());
  });

  async function staleOrderFor(provider: string, variantId: string, customerId: string) {
    registerAdapter(new RenamedSandboxAdapter(provider) as unknown as PaymentAdapter);
    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider,
      enabled: true,
      isDefault: true,
      methods: ["pix"],
      pixDiscountPercent: 0,
    });
    const created = await handleCheckout(
      db,
      { items: [{ variantId, quantity: 1 }], address: addr(), paymentMethod: "pix", acceptedTerms: true, ageConfirmed: true } as any,
      { customerId, ip: "127.0.0.1" },
    );
    await db.update(schema.orders).set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }).where(eq(schema.orders.id, created.orderId));
    const [pay] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, created.orderId));
    await db.update(schema.payments).set({ provider }).where(eq(schema.payments.id, pay.id));
    return { orderId: created.orderId, pay };
  }

  async function installAuditFailTrigger(action: string) {
    await db.execute(`CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger AS $fn$ BEGIN RAISE EXCEPTION 'falha de auditoria forçada (teste): %', NEW.action; END; $fn$ LANGUAGE plpgsql`);
    await db.execute(
      `CREATE TRIGGER test_fail_audit BEFORE INSERT ON "audit_logs" FOR EACH ROW WHEN (NEW."action" = '${action}') EXECUTE FUNCTION test_fail_audit()`,
    );
  }

  async function dropAuditFailTrigger() {
    await db.execute(`DROP TRIGGER IF EXISTS test_fail_audit ON "audit_logs"`);
    await db.execute(`DROP FUNCTION IF EXISTS test_fail_audit()`);
  }

  it("EXPIRAÇÃO (cancelamento + estoque): auditoria 'expiry.cancelled' falha ⇒ pagamento, pedido, estoque, histórico e auditoria revertidos", async () => {
    const provider = "audit-fail-exp";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const { orderId } = await staleOrderFor(provider, variant.id, customerId);

    // Provedor reports EXPIRADO: caminho de cancelamento — transição
    // cancelado + liberação de estoque + auditoria, TUDO na mesma transação.
    class ExpiredAdapter extends RenamedSandboxAdapter {
      constructor(providerName: string) {
        super(providerName);
      }
      async queryPaymentByOrder(): Promise<QueryPaymentResult | null> {
        return { status: "expirado", amountCents: 10000, currency: "BRL" };
      }
    }
    registerAdapter(new ExpiredAdapter(provider) as unknown as PaymentAdapter);

    await installAuditFailTrigger("expiry.cancelled");
    try {
      let threw: unknown = null;
      try {
        await expireStaleReservations(db, { olderThanMinutes: 60 });
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeTruthy(); // a falha de auditoria PROPAGA (transação rejeita)

      // Pagamento: NADA assentado.
      const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
      expect(payAfter!.status).toBe("pendente");
      expect(payAfter!.capturedAt).toBeNull();
      // Pedido: sem transição.
      const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
      expect(order!.status).toBe("aguardando_pagamento");
      // Estoque: reserva preservada.
      const [inv] = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
      expect(inv.reserved).toBe(1);
      // Histórico: só a entrada de criação.
      const history = await db.select().from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, orderId));
      expect(history.filter((h: any) => h.toStatus !== "aguardando_pagamento").length).toBe(0);
      // Auditoria: NENHUM registro da ação (o INSERT falhou e reverteu junto).
      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.action, "expiry.cancelled"), eq(schema.auditLogs.entityId, orderId)));
      expect(audits.length).toBe(0);
    } finally {
      await dropAuditFailTrigger();
    }
  });

  it("WEBHOOK pagamento tardio: auditoria 'order.late_payment' falha ⇒ pagamento, pedido e marcação do evento revertidos", async () => {
    const provider = "audit-fail-lp";
    const customerId = await getCustomerId();
    const variant = await getVariant();
    const { orderId, pay } = await staleOrderFor(provider, variant.id, customerId);
    // Estado legado divergente: pedido cancelado, pagamento pendente — o
    // webhook approved entra no caminho de pagamento tardio.
    await db.update(schema.orders).set({ status: "cancelado" }).where(eq(schema.orders.id, orderId));

    const raw = JSON.stringify({
      id: "audit-fail-lp-1",
      type: "payment.approved",
      data: { transactionId: pay.providerTransactionId, amountCents: pay.amountCents, currency: "BRL" },
    });
    const parsed = (getAdapter(provider) as PaymentAdapter)!.parseWebhook(raw);
    const [evt] = await db
      .insert(schema.paymentEvents)
      .values({ provider, eventId: parsed.eventId, type: "payment.approved", payload: JSON.parse(raw), signatureValid: true })
      .returning();

    await installAuditFailTrigger("order.late_payment");
    try {
      let threw: unknown = null;
      try {
        await applyPaymentEvent(db, { provider, event: parsed, payment: pay, eventRowId: evt.id, leaseToken: undefined, signatureValid: true });
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeTruthy(); // auditoria NA transação: falha rejeita tudo

      // Pagamento: sem assentamento tardio.
      const [payAfter] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
      expect(payAfter!.status).toBe("pendente");
      expect(payAfter!.capturedAt).toBeNull();
      // Pedido: permanece cancelado.
      const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
      expect(order!.status).toBe("cancelado");
      // Evento: marcação (última escrita da transação) revertida — volta à fila.
      const [evtAfter] = await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.id, evt.id));
      expect(evtAfter!.processedAt).toBeNull();
      expect(evtAfter!.deadLetter).toBe(false);
      // Auditoria: nada gravado.
      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.action, "order.late_payment"), eq(schema.auditLogs.entityId, orderId)));
      expect(audits.length).toBe(0);
    } finally {
      await dropAuditFailTrigger();
    }
  });
});


