import { describe, it, expect, beforeEach } from "vitest";
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

async function ensureTables() {
  // Drop e recria para garantir esquema limpo entre execucoes do vitest
  await db.execute(`DROP TABLE IF EXISTS "payment_events" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "payments" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "order_status_history" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "order_items" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "orders" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "inventory_movements" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "watchlist" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "coupons" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "gateway_configs" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "fraud_rules" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "fraud_assessments" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "audit_logs" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "inventory" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "product_variants" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "products" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "brands" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "categories" CASCADE`);
  await db.execute(`DROP TABLE IF EXISTS "customers" CASCADE`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "customers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(120) NOT NULL,
      "email" varchar(254) NOT NULL,
      "password_hash" text,
      "cpf" varchar(11),
      "phone" varchar(20),
      "born_at" timestamptz,
      "age_verified_at" timestamptz,
      "notes" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_idx" ON "customers" ("email")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "customer_addresses" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
      "recipient" varchar(120) NOT NULL,
      "zip" varchar(8) NOT NULL,
      "street" varchar(160) NOT NULL,
      "number" varchar(20) NOT NULL,
      "complement" varchar(120),
      "neighborhood" varchar(80) NOT NULL,
      "city" varchar(80) NOT NULL,
      "state" varchar(2) NOT NULL,
      "country" varchar(2) NOT NULL DEFAULT 'BR',
      "is_default" boolean NOT NULL DEFAULT false
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS "customer_addresses_customer_idx" ON "customer_addresses" ("customer_id")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "categories" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "parent_id" uuid,
      "name" varchar(80) NOT NULL,
      "slug" varchar(80) NOT NULL,
      "description" text DEFAULT '',
      "image_url" text,
      "age_restricted" boolean NOT NULL DEFAULT false,
      "active" boolean NOT NULL DEFAULT true,
      "position" integer NOT NULL DEFAULT 0
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "categories_slug_idx" ON "categories" ("slug")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "brands" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(80) NOT NULL,
      "slug" varchar(80) NOT NULL,
      "logo_url" text,
      "description" text DEFAULT '',
      "position" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "brands_slug_idx" ON "brands" ("slug")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "products" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name" varchar(160) NOT NULL,
      "slug" varchar(160) NOT NULL,
      "short_description" text DEFAULT '',
      "description" text DEFAULT '',
      "category_id" uuid NOT NULL,
      "brand_id" uuid,
      "age_restricted" boolean NOT NULL DEFAULT false,
      "featured" boolean NOT NULL DEFAULT false,
      "published" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "product_variants" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "product_id" uuid NOT NULL,
      "sku" varchar(64) NOT NULL,
      "name" varchar(120) NOT NULL,
      "price_cents" integer NOT NULL,
      "promo_price_cents" integer,
      "weight_grams" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "inventory" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "variant_id" uuid NOT NULL,
      "physical" integer NOT NULL DEFAULT 0,
      "reserved" integer NOT NULL DEFAULT 0,
      "min_quantity" integer NOT NULL DEFAULT 0,
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "fraud_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "key" varchar(60) NOT NULL,
      "name" varchar(120) NOT NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "weight" integer NOT NULL DEFAULT 10,
      "threshold" integer,
      "action" varchar(20) NOT NULL DEFAULT 'soma',
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "fraud_rules_key_idx" ON "fraud_rules" ("key")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "fraud_assessments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL,
      "score" integer NOT NULL,
      "level" varchar(20) NOT NULL,
      "action" varchar(20) NOT NULL,
      "reasons" jsonb NOT NULL,
      "ip" varchar(45),
      "device_fingerprint" text,
      "auto_decision" boolean NOT NULL DEFAULT true,
      "reviewed_by_user_id" uuid,
      "review_note" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "watchlist" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kind" varchar(20) NOT NULL,
      "value" varchar(254) NOT NULL,
      "reason" text NOT NULL,
      "added_by_user_id" uuid,
      "expires_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "watchlist_kind_value_idx" ON "watchlist" ("kind", "value")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "orders" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "number" varchar(20) NOT NULL,
      "customer_id" uuid NOT NULL,
      "status" varchar(40) NOT NULL DEFAULT 'aguardando_pagamento',
      "subtotal_cents" integer NOT NULL,
      "discount_cents" integer NOT NULL DEFAULT 0,
      "shipping_cents" integer NOT NULL DEFAULT 0,
      "total_cents" integer NOT NULL,
      "coupon_code" varchar(40),
      "payment_method" varchar(20),
      "address_json" jsonb NOT NULL,
      "customer_notes" text,
      "terms_version" varchar(20),
      "terms_accepted_at" timestamptz,
      "terms_ip" varchar(45),
      "volume_day" varchar(10),
      "risk_level" varchar(20),
      "risk_score" integer DEFAULT 0,
      "risk_reasons" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "order_items" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL,
      "variant_id" uuid NOT NULL,
      "sku" varchar(64) NOT NULL,
      "name" varchar(200) NOT NULL,
      "quantity" integer NOT NULL,
      "unit_price_cents" integer NOT NULL,
      "total_cents" integer NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "order_status_history" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL,
      "from_status" varchar(40),
      "to_status" varchar(40) NOT NULL,
      "reason" text,
      "actor_user_id" uuid,
      "actor_system" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "payments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "order_id" uuid NOT NULL,
      "provider" varchar(32) NOT NULL,
      "method" varchar(20) NOT NULL,
      "status" varchar(20) NOT NULL DEFAULT 'pendente',
      "amount_cents" integer NOT NULL,
      "authorized_cents" integer,
      "provider_transaction_id" varchar(120),
      "payload" text,
      "expires_at" timestamptz,
      "captured_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "payment_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "payment_id" uuid,
      "provider" varchar(32) NOT NULL,
      "event_id" varchar(160) NOT NULL,
      "type" varchar(80) NOT NULL,
      "payload" jsonb NOT NULL,
      "signature_valid" boolean,
      "processed_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "inventory_movements" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "variant_id" uuid NOT NULL,
      "type" varchar(20) NOT NULL,
      "quantity" integer NOT NULL,
      "physical_before" integer NOT NULL,
      "physical_after" integer NOT NULL,
      "reserved_before" integer NOT NULL,
      "reserved_after" integer NOT NULL,
      "reason" text NOT NULL,
      "order_id" uuid,
      "user_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "coupons" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "code" varchar(40) NOT NULL,
      "kind" varchar(20) NOT NULL,
      "value" integer NOT NULL,
      "min_order_cents" integer NOT NULL DEFAULT 0,
      "max_uses" integer,
      "used_count" integer NOT NULL DEFAULT 0,
      "starts_at" timestamptz,
      "ends_at" timestamptz,
      "active" boolean NOT NULL DEFAULT true
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_idx" ON "coupons" ("code")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "gateway_configs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "provider" varchar(32) NOT NULL,
      "credentials_encrypted" text,
      "enabled" boolean NOT NULL DEFAULT false,
      "is_default" boolean NOT NULL DEFAULT false,
      "methods" jsonb NOT NULL DEFAULT '["pix", "cartao", "boleto"]',
      "capture_after_review" boolean NOT NULL DEFAULT false,
      "require3ds" boolean NOT NULL DEFAULT false,
      "pix_discount_percent" integer NOT NULL DEFAULT 0,
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "updated_by_user_id" uuid
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "gateway_configs_provider_idx" ON "gateway_configs" ("provider")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "actor_user_id" uuid,
      "actor_label" varchar(120),
      "action" varchar(80) NOT NULL,
      "entity" varchar(60) NOT NULL,
      "entity_id" varchar(64),
      "before_json" text,
      "after_json" text,
      "ip" varchar(45),
      "correlation_id" varchar(64),
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function clearTables() {
  await db.execute(`DELETE FROM "payment_events"`);
  await db.execute(`DELETE FROM "payments"`);
  await db.execute(`DELETE FROM "order_status_history"`);
  await db.execute(`DELETE FROM "order_items"`);
  await db.execute(`DELETE FROM "orders"`);
  await db.execute(`DELETE FROM "inventory_movements"`);
  await db.execute(`DELETE FROM "watchlist"`);
  await db.execute(`DELETE FROM "audit_logs"`);
  await db.execute(`UPDATE "inventory" SET reserved = 0`);
}

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
    city: "Campinas",
    state: "SP",
    country: "BR",
  };
}

describe("checkout service", () => {
  beforeEach(async () => {
    db = await getDb();
    // Schema completo antes dos fixtures: o teste não pode depender de tabelas
    // que por acaso existam no banco de desenvolvimento.
    await migrate(db);
    await ensureTables();
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
      addedByUserId: customerId,
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
    db = await getDb();
    await ensureTables();
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

    await consumeStock(db, { variantId: variant.id, quantity: 2, orderId: crypto.randomUUID(), userId: crypto.randomUUID(), reason: "Baixa teste" });

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
      userId: crypto.randomUUID(),
    });
    const after = await getAvailable(db, variant.id);
    expect(after).toBe(before + 50);
  });
});

describe("concorrencia de estoque", () => {
  it("20 compras simultaneas do ultimo item: 1 vende, 19 rejeitam, estoque nunca negativo", async () => {
    db = await getDb();
    await migrate(db);
    await ensureTables();
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
