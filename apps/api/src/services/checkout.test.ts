import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { handleCheckout } from "./checkout.js";
import { reserveStock, releaseStock, consumeStock, adjustStock, getAvailable } from "./inventory.js";
import { calculateShipping } from "./shipping.js";
import { eq } from "drizzle-orm";

const customerEmail = "cliente@demo.com";

let db: any;

/** Limpa dados entre testes. audit_logs é append-only (trigger) — não deletar. */
async function clearTables() {
  // ordem respeita FKs do schema real (migrações). audit_logs é append-only (trigger).
  await db.execute(`DELETE FROM "payment_events"`).catch(() => {});
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
  if (rows.length === 0) {
    const inserted = await db.insert(schema.customers).values({
      name: "Cliente Demo",
      email: customerEmail,
      passwordHash: "hash",
      cpf: "12345678901",
      phone: "19999999999",
    }).returning();
    return inserted[0]!.id;
  }
  return rows[0]!.id;
}

async function getPublishedVariantId() {
  let [cat] = await db.select().from(schema.categories).limit(1);
  if (!cat) {
    const inserted = await db.insert(schema.categories).values({
      name: "Fuzis e Rifles",
      slug: "fusis-e-rifles",
      ageRestricted: true,
      active: true,
    }).returning();
    cat = inserted[0]!;
  }
  let [brand] = await db.select().from(schema.brands).limit(1);
  if (!brand) {
    const inserted = await db.insert(schema.brands).values({
      name: "G&G",
      slug: "gg",
    }).returning();
    brand = inserted[0]!;
  }
  const [prod] = await db
    .insert(schema.products)
    .values({
      name: "Fusil Teste",
      slug: "fusil-teste",
      categoryId: cat.id,
      brandId: brand.id,
      ageRestricted: true,
      featured: false,
      published: true,
    })
    .returning();
  const [variant] = await db
    .insert(schema.productVariants)
    .values({
      productId: prod.id,
      sku: "SKU-TESTE",
      name: "Fusil Teste",
      priceCents: 100000,
      active: true,
    })
    .returning();
  await db.insert(schema.inventory).values({
    variantId: variant.id,
    physical: 20,
    reserved: 0,
    minQuantity: 3,
  });
  return variant;
}

function addr(number: string) {
  return {
    recipient: "Cliente Teste",
    zip: "13000000",
    street: "Rua Teste",
    number,
    complement: "",
    neighborhood: "Centro",
    city: "Americana",
    state: "SP",
    country: "BR",
  };
}

describe("checkout service", () => {
  beforeEach(async () => {
    await clearTables();
  });

  it("cria pedido, reserva estoque e gera pagamento PIX pendente", async () => {
    const customerId = await getCustomerId();
    const variant = await getPublishedVariantId();

    const result = await handleCheckout(
      db,
      {
        items: [{ variantId: variant.id, quantity: 2 }],
        address: addr("100"),
        paymentMethod: "pix",
        acceptedTerms: true,
      },
      { customerId, ip: "127.0.0.1", correlationId: "test-001" },
    );

    expect(result.orderId).toBeDefined();
    expect(result.orderNumber).toMatch(/^AA-\d{6}-\d{6}$/);
    expect(result.status).toBe("pagamento_aprovado");
    expect(result.payment.method).toBe("pix");
    expect(result.payment.provider).toBe("sandbox");
    expect(result.payment.status).toBe("pendente");
    expect(result.payment.providerTransactionId).toMatch(/^sbx_/);
    expect(result.payment.expiresAt).toBeDefined();

    const inv = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv[0]!.reserved).toBe(2);
  });

  it("rejeita estoque insuficiente com 409", async () => {
    const customerId = await getCustomerId();
    const variant = await getPublishedVariantId();

    const inv = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    const available = inv[0]!.physical - inv[0]!.reserved;

    await expect(
      handleCheckout(
        db,
        {
          items: [{ variantId: variant.id, quantity: available + 1 }],
          address: addr("100"),
          paymentMethod: "pix",
          acceptedTerms: true,
        },
        { customerId, ip: "127.0.0.1", correlationId: "test-002" },
      ),
    ).rejects.toMatchObject({ code: "insufficient_stock", status: 409 });
  });

  it("aplica desconto PIX de 5% via gateway config", async () => {
    const customerId = await getCustomerId();
    const variant = await getPublishedVariantId();

    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "sandbox",
      enabled: true,
      isDefault: true,
      methods: ["pix", "cartao", "boleto"],
      pixDiscountPercent: 5,
    });

    const result = await handleCheckout(
      db,
      {
        items: [{ variantId: variant.id, quantity: 1 }],
        address: addr("100"),
        paymentMethod: "pix",
        acceptedTerms: true,
      },
      { customerId, ip: "127.0.0.1", correlationId: "test-003" },
    );

    const unitPrice = variant.priceCents;
    const shippingOptions = calculateShipping({
      zip: "13000000",
      subtotalCents: unitPrice,
      totalWeightGrams: variant.weightGrams,
      freeShippingFromCents: 0,
    });
    const shippingCents = shippingOptions[0]?.priceCents ?? 0;
    const expectedTotal = Math.floor(unitPrice * 0.95) + shippingCents;
    const payRow = await db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, result.orderId));
    expect(payRow[0]!.amountCents).toBe(expectedTotal);
  });

  it("antifraude alto bloqueia pagamento com status recusado", async () => {
    const customerId = await getCustomerId();
    const variant = await getPublishedVariantId();

    await db.insert(schema.gatewayConfigs).values({
      id: crypto.randomUUID(),
      provider: "sandbox",
      enabled: true,
      isDefault: true,
      methods: ["pix", "cartao", "boleto"],
      pixDiscountPercent: 5,
    });

    await db.insert(schema.watchlist).values({
      id: crypto.randomUUID(),
      kind: "email",
      value: customerEmail,
      reason: "teste watchlist",
      addedByUserId: null, // FK -> users (nullable); customerId é de customers
    });

    const result = await handleCheckout(
      db,
      {
        items: [{ variantId: variant.id, quantity: 1 }],
        address: addr("100"),
        paymentMethod: "pix",
        acceptedTerms: true,
      },
      { customerId, ip: "127.0.0.1", correlationId: "test-004" },
    );

    expect(result.status).toBe("aguardando_revisao_manual");
    expect(result.payment.status).toBe("pendente");
  });

  it("cupom invalido lança 400", async () => {
    const customerId = await getCustomerId();
    const variant = await getPublishedVariantId();

    await db.insert(schema.coupons).values({
      id: crypto.randomUUID(),
      code: "PIX5",
      kind: "percentual",
      value: 5,
      active: true,
    });

    await expect(
      handleCheckout(
        db,
        {
          items: [{ variantId: variant.id, quantity: 1 }],
          address: addr("100"),
          paymentMethod: "pix",
          couponCode: "NAOEXISTE",
          acceptedTerms: true,
        },
        { customerId, ip: "127.0.0.1", correlationId: "test-005" },
      ),
    ).rejects.toMatchObject({ code: "invalid_coupon", status: 400 });
  });
});

describe("estoque transacional", () => {
  beforeEach(async () => {
    await clearTables();
  });

  it("reserva e libera estoque corretamente", async () => {
    const variant = await getPublishedVariantId();

    const before = await getAvailable(db, variant.id);
    await reserveStock(db, { variantId: variant.id, quantity: 3, orderId: crypto.randomUUID(), reason: "Reserva teste" });
    const afterReserve = await getAvailable(db, variant.id);
    expect(afterReserve).toBe(before - 3);

    await releaseStock(db, { variantId: variant.id, quantity: 3, orderId: crypto.randomUUID(), reason: "Libera teste" });
    const afterRelease = await getAvailable(db, variant.id);
    expect(afterRelease).toBe(before);
  });

  it("consumo baixa fisico e reservado", async () => {
    const variant = await getPublishedVariantId();

    const invBefore = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    const physicalBefore = invBefore[0]!.physical;
    const reservedBefore = invBefore[0]!.reserved;

    await consumeStock(db, { variantId: variant.id, quantity: 2, orderId: crypto.randomUUID(), userId: undefined, reason: "Baixa teste" });

    const invAfter = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(invAfter[0]!.physical).toBe(physicalBefore - 2);
    expect(invAfter[0]!.reserved).toBe(Math.max(0, reservedBefore - 2));
  });

  it("ajuste de entrada aumenta estoque fisico", async () => {
    const variant = await getPublishedVariantId();

    const before = await getAvailable(db, variant.id);
    await adjustStock(db, {
      variantId: variant.id,
      type: "entrada",
      quantity: 50,
      reason: "Entrada teste",
      userId: null,
    });
    const after = await getAvailable(db, variant.id);
    expect(after).toBe(before + 50);
  });
});

describe("concorrencia de estoque", () => {
  it("20 compras simultaneas do ultimo item: 1 vende, 19 rejeitam, estoque nunca negativo", async () => {
    await clearTables();
    const customerId = await getCustomerId();

    let [cat] = await db.select().from(schema.categories).limit(1);
    if (!cat) {
      const inserted = await db.insert(schema.categories).values({
        name: "Fuzis e Rifles",
        slug: "fusis-e-rifles",
        ageRestricted: true,
        active: true,
      }).returning();
      cat = inserted[0]!;
    }
    let [brand] = await db.select().from(schema.brands).limit(1);
    if (!brand) {
      const inserted = await db.insert(schema.brands).values({ name: "Teste", slug: "teste" }).returning();
      brand = inserted[0]!;
    }
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: "Produto Concorrencia",
        slug: "produto-concorrencia",
        categoryId: cat.id,
        brandId: brand.id,
        ageRestricted: false,
        featured: false,
        published: true,
      })
      .returning();
    const [variant] = await db
      .insert(schema.productVariants)
      .values({
        productId: prod.id,
        sku: "SKU-CONC",
        name: "Produto Concorrencia",
        priceCents: 10000,
        active: true,
      })
      .returning();
    await db.insert(schema.inventory).values({
      variantId: variant.id,
      physical: 1,
      reserved: 0,
      minQuantity: 0,
    });

    const checkoutCalls = Array.from({ length: 20 }, (_, i) =>
      handleCheckout(
        db,
        {
          items: [{ variantId: variant.id, quantity: 1 }],
          address: addr(String(100 + i)),
          paymentMethod: "pix",
          acceptedTerms: true,
        },
        { customerId, ip: `127.0.0.${i % 255 + 1}`, correlationId: `test-conc-${i}` },
      ),
    );

    const results = await Promise.allSettled(checkoutCalls);
    const approved = results.filter(
      (r) => r.status === "fulfilled" && (r as PromiseFulfilledResult<{ status: string }>).value.status === "pagamento_aprovado",
    ).length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    expect(approved).toBe(1);
    expect(rejected).toBe(19);

    const inv = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id));
    expect(inv[0]!.reserved).toBe(1);
    expect(inv[0]!.physical).toBe(1);
  });
});
