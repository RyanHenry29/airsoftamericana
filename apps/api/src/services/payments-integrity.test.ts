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
import { eq } from "drizzle-orm";
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

function approvedEvent(txId: string, i = 0): NormalizedWebhookEvent {
  return {
    eventId: `integ:${txId}:${i}`,
    type: "payment.approved",
    providerTransactionId: txId,
    amountCents: 10000,
    raw: { id: `${i}`, type: "payment.approved", data: { transactionId: txId } },
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
      event: approvedEvent(pay.providerTransactionId!),
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
    const event = approvedEvent(pay.providerTransactionId!);

    const first = await applyPaymentEvent(db, { provider: "sandbox", event, payment: pay });
    expect(first.applied).toBe(true);

    const [payReloaded] = await db.select().from(schema.payments).where(eq(schema.payments.id, pay.id));
    const second = await applyPaymentEvent(db, { provider: "sandbox", event: approvedEvent(pay.providerTransactionId!, 1), payment: payReloaded });
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
      event: approvedEvent(pay.providerTransactionId!),
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

    const ev1 = approvedEvent(pay.providerTransactionId!, 1);
    const ev2 = approvedEvent(pay.providerTransactionId!, 2);

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
