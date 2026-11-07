// language: TS, file: apps/api/src/routes/price-stock-transactional.test.ts, target: vitest
// HTTP + integração (app.inject, migrações reais, DB isolado por instância de teste do worker)
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { createSession } from "../services/sessions.js";
import { csrfGuard, csrfTokenForSession } from "../lib/csrf.js";
import { authMiddleware } from "../middleware/auth.js";
import { registerAdminRoutes } from "./admin.js";
import { routes } from "./index.js";

let db: any;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function makeAuthed(role: string) {
  const email = `pst-${role}-${RUN}-${Math.random().toString(36).slice(2)}@t.local`;
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword("Senha123!"), name: role, role, active: true, mfaEnabled: true })
    .returning();
  const s = await createSession(db, { userId: u.id, mfaVerified: true });
  return { userId: u.id, token: s.token, csrf: csrfTokenForSession(s.id) };
}

const testConfig = {
  API_PORT: 4321, API_HOST: "127.0.0.1", NODE_ENV: "test", DATABASE_URL: "", JWT_SECRET: "test-secret-do-not-use-in-production",
  GATEWAY_SECRETS_KEY: "", STORE_URL: "http://localhost:3000", ADMIN_URL: "http://localhost:3001", STORE_NAME: "Airsoft Americana",
  STORE_WHATSAPP: "", GATEWAY_ACTIVE: "sandbox", LOG_LEVEL: "silent", MERCADOPAGO_ACCESS_TOKEN: "", PAGBANK_API_KEY: "",
  CIELO_CLIENT_ID: "", CIELO_CLIENT_SECRET: "", AUTH_LOGIN_MAX: 5, AUTH_LOGIN_WINDOW_MS: 60_000, AUTH_LOGIN_BLOCK_MS: 15 * 60_000,
  AUTH_REGISTER_MAX: 3, AUTH_REGISTER_WINDOW_MS: 60 * 60_000, AUTH_REGISTER_BLOCK_MS: 24 * 60 * 60_000, AUTH_ADMIN_MAX: 10,
  AUTH_ADMIN_WINDOW_MS: 60_000, AUTH_ADMIN_BLOCK_MS: 15 * 60_000, RATE_LIMIT_MAX: 600, RATE_LIMIT_WINDOW_MS: 60_000,
  CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "",
} as any;

async function buildAppIndex() {
  const app = fastify({ bodyLimit: 4 * 1024 * 1024 });
  await app.register(cookie);
  app.decorate("db", db);
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin")) await authMiddleware(req as any);
  });
  app.addHook("preHandler", csrfGuard);
  await routes(app, testConfig, db);
  await app.ready();
  return app;
}

async function buildAppAdmin() {
  const app = fastify({ bodyLimit: 4 * 1024 * 1024 });
  await app.register(cookie);
  app.decorate("db", db);
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin")) await authMiddleware(req as any);
  });
  app.addHook("preHandler", csrfGuard);
  registerAdminRoutes(app, db);
  await app.ready();
  return app;
}

async function seedCategory(slug: string) {
  await db.insert(schema.categories).values({ name: `[DEMO] ${slug}`, slug, description: "", ageRestricted: false, active: true, position: 0 } as any).onConflictDoNothing({ target: schema.categories.slug } as any);
  const [c] = await db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.slug, slug)).limit(1);
  return c!.id;
}

async function seedProductWithVariant(opts: { physical?: number; reserved?: number; min?: number; priceCents?: number } = {}) {
  const catId = await seedCategory(`cat-pst-${RUN}`);
  const sku = `PST-${RUN}-${Math.random().toString(36).slice(2, 7)}`;
  const slug = `prod-${sku.toLowerCase()}`;
  const [p] = await db.insert(schema.products).values({ name: `[DEMO] ${slug}`, slug, shortDescription: "d", description: "d", categoryId: catId, ageRestricted: false, featured: false, published: true, condicao: "novo" } as any).returning();
  const [v] = await db.insert(schema.productVariants).values({ productId: p.id, sku, name: "Padrao", priceCents: opts.priceCents ?? 10000, promoPriceCents: null, active: true, weightGrams: 100 } as any).returning();
  const [inv] = await db.insert(schema.inventory).values({ variantId: v.id, physical: opts.physical ?? 10, reserved: opts.reserved ?? 0, minQuantity: opts.min ?? 0 } as any).returning();
  return { product: p, variant: v, inventory: inv };
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

describe("Criação atômica de produto (POST /api/admin/products)", () => {
  it("cria produto+variantes+inventário+histórico+auditoria em transação única (sucesso)", async () => {
    const app = await buildAppIndex();
    const a = await makeAuthed("superadmin");
    const catId = await seedCategory(`cat-atom-${RUN}`);
    const sku1 = `ATOM1-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
    const sku2 = `ATOM2-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
    const slug = `atom-ok-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await app.inject({
      method: "POST", url: "/api/admin/products",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: {
        name: "[DEMO] Atom", slug, description: "d", categoryId: catId, ageRestricted: false, featured: false, published: true,
        variants: [
          { sku: sku1, name: "V1", priceCents: 1000, stockPhysical: 5, stockMin: 1, weightGrams: 100, active: true },
          { sku: sku2, name: "V2", priceCents: 2000, stockPhysical: 3, stockMin: 0, weightGrams: 100, active: true },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json();
    expect(body.product.variants).toHaveLength(2);
    for (const v of body.product.variants) {
      const inv = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, v.id)).limit(1);
      expect(inv[0]).toBeDefined();
    }
    const hist = await db.select().from(schema.productChangeHistory).where(eq(schema.productChangeHistory.productId, body.product.id));
    expect(hist.length).toBeGreaterThan(0);
    const aud = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entity, "products"), eq(schema.auditLogs.entityId, body.product.id)));
    expect(aud.length).toBeGreaterThan(0);
    await app.close();
  });

  it("rollback total quando variante falha (SKU duplicado na mesma requisição) — nenhum produto/variante/inventário/histórico órfão", async () => {
    const app = await buildAppIndex();
    const a = await makeAuthed("superadmin");
    const catId = await seedCategory(`cat-atomr-${RUN}`);
    const dupSku = `ATOMDUP-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
    const slug = `atom-dup-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
    const beforeP = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, slug));
    expect(beforeP).toHaveLength(0);
    const res = await app.inject({
      method: "POST", url: "/api/admin/products",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: {
        name: "[DEMO] Atom Dup", slug, description: "d", categoryId: catId, ageRestricted: false, featured: false, published: false,
        variants: [
          { sku: dupSku, name: "V1", priceCents: 1000, stockPhysical: 5, stockMin: 0, weightGrams: 100, active: true },
          { sku: dupSku, name: "V2", priceCents: 2000, stockPhysical: 1, stockMin: 0, weightGrams: 100, active: true },
        ],
      },
    });
    // falha por constraint única de SKU => transação desfaz tudo
    expect([400, 409, 500]).toContain(res.statusCode);
    const afterP = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.slug, slug));
    expect(afterP).toHaveLength(0);
    const vRows = await db.select({ id: schema.productVariants.id }).from(schema.productVariants).where(eq(schema.productVariants.sku, dupSku));
    expect(vRows).toHaveLength(0);
    // sem histórico/auditoria do produto (produto não existe)
    await app.close();
  });

  it("requer RBAC (atendimento não cria) e CSRF", async () => {
    const app = await buildAppIndex();
    const at = await makeAuthed("atendimento");
    const catId = await seedCategory(`cat-atomrbac-${RUN}`);
    const base = { name: "[DEMO] X", slug: `atom-rbac-${RUN}-${Math.random().toString(36).slice(2, 5)}`, description: "d", categoryId: catId, ageRestricted: false, featured: false, published: false, variants: [{ sku: `RBACSKU-${RUN}-${Math.random().toString(36).slice(2, 5)}`, name: "V", priceCents: 100, stockPhysical: 1, stockMin: 0, weightGrams: 1, active: true }] };
    const noPerm = await app.inject({ method: "POST", url: "/api/admin/products", cookies: { aa_session: at.token }, headers: { "x-csrf-token": at.csrf }, payload: base });
    expect(noPerm.statusCode, noPerm.body).toBe(403);
    const sa = await makeAuthed("superadmin");
    const v0 = base.variants[0]!;
    const noCsrf = await app.inject({ method: "POST", url: "/api/admin/products", cookies: { aa_session: sa.token }, payload: { ...base, slug: base.slug + "-2", variants: [{ ...v0, sku: v0.sku + "-2" }] } });
    expect([403, 400, 419]).toContain(noCsrf.statusCode);
    await app.close();
  });
});


describe("PATCH /api/admin/variants/:id (admin.ts) - seguranca e consistencia", () => {
  it("rejeita negativos, valida reservado, RBAC e CSRF; registra historico/auditoria; rollback em falha", async () => {
    const app = await buildAppAdmin();
    const sa = await makeAuthed("superadmin");
    const at = await makeAuthed("atendimento");
    const { product, variant } = await seedProductWithVariant({ physical: 10, reserved: 3, min: 1, priceCents: 5000 });

    const noCsrf = await app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: sa.token }, payload: { priceCents: 6000 } });
    expect([400,403,419]).toContain(noCsrf.statusCode);

    const noPerm = await app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: at.token }, headers: { "x-csrf-token": at.csrf }, payload: { priceCents: 6000 } });
    expect(noPerm.statusCode, noPerm.body).toBe(403);

    for (const payload of [{ priceCents: -1 }, { promoPriceCents: -5 }, { weightGrams: -1 }, { stockPhysical: -1 }, { stockMin: -1 }]) {
      const r = await app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload });
      expect(r.statusCode, JSON.stringify(payload)+r.body).toBe(400);
    }

    const below = await app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { stockPhysical: 2 } });
    expect(below.statusCode, below.body).toBe(409);

    const beforeHist = await db.select().from(schema.productChangeHistory).where(eq(schema.productChangeHistory.productId, product.id));
    const ok = await app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { priceCents: 7777, stockPhysical: 8, stockMin: 2 } });
    expect(ok.statusCode, ok.body).toBe(200);
    const inv = (await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id)).limit(1))[0];
    expect(inv.physical).toBe(8);
    expect(inv.reserved).toBe(3);
    const vrow = (await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, variant.id)).limit(1))[0];
    expect(vrow.priceCents).toBe(7777);
    const afterHist = await db.select().from(schema.productChangeHistory).where(eq(schema.productChangeHistory.productId, product.id));
    expect(afterHist.some((h: any) => h.field === "variant.priceCents")).toBe(true);
    expect(afterHist.some((h: any) => h.field === "variant.stock")).toBe(true);
    const aud = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entity, "product_variants"), eq(schema.auditLogs.entityId, variant.id)));
    expect(aud.length).toBeGreaterThan(0);

    const beforePhys = (await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id)).limit(1))[0].physical;
    const fail = await app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { stockPhysical: 1 } });
    expect(fail.statusCode).toBe(409);
    const afterPhys = (await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id)).limit(1))[0].physical;
    expect(afterPhys).toBe(beforePhys);
    await app.close();
  });

  it("concorrencia: alteracoes paralelas serializadas; reservado nunca violado", async () => {
    const app = await buildAppAdmin();
    const sa = await makeAuthed("superadmin");
    const { variant } = await seedProductWithVariant({ physical: 10, reserved: 4, min: 0, priceCents: 1000 });
    const [r1, r2] = await Promise.all([
      app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { stockPhysical: 5 } }),
      app.inject({ method: "PATCH", url: `/api/admin/variants/${variant.id}`, cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { stockPhysical: 3 } }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toContain(409);
    const inv = (await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id)).limit(1))[0];
    expect(inv.physical).toBeGreaterThanOrEqual(inv.reserved);
    await app.close();
  });
});

describe("POST /api/admin/inventory/movements (HTTP real, transacao consistente)", () => {
  it("movimentacao + auditoria na mesma transacao; RBAC/CSRF; bloqueia negativo e abaixo do reservado", async () => {
    const app = await buildAppIndex();
    const sa = await makeAuthed("superadmin");
    const at = await makeAuthed("atendimento");
    const { variant } = await seedProductWithVariant({ physical: 10, reserved: 2, min: 0, priceCents: 1000 });

    const noCsrf = await app.inject({ method: "POST", url: "/api/admin/inventory/movements", cookies: { aa_session: sa.token }, payload: { variantId: variant.id, type: "entrada", quantity: 1, reason: "teste" } });
    expect([400,403,419]).toContain(noCsrf.statusCode);
    const noPerm = await app.inject({ method: "POST", url: "/api/admin/inventory/movements", cookies: { aa_session: at.token }, headers: { "x-csrf-token": at.csrf }, payload: { variantId: variant.id, type: "entrada", quantity: 1, reason: "teste" } });
    expect(noPerm.statusCode, noPerm.body).toBe(403);

    const below = await app.inject({ method: "POST", url: "/api/admin/inventory/movements", cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { variantId: variant.id, type: "saida", quantity: 9, reason: "baixar demais" } });
    expect([400,409]).toContain(below.statusCode);
    const invAfterFail = (await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id)).limit(1))[0];
    expect(invAfterFail.physical).toBe(10);

    const ok = await app.inject({ method: "POST", url: "/api/admin/inventory/movements", cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { variantId: variant.id, type: "entrada", quantity: 5, reason: "reposicao teste" } });
    expect(ok.statusCode, ok.body).toBe(200);
    const inv = (await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id)).limit(1))[0];
    expect(inv.physical).toBe(15);
    const aud = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entity, "inventory"), eq(schema.auditLogs.action, "stock.movement")));
    expect(aud.length).toBeGreaterThan(0);
    const movs = await db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.variantId, variant.id));
    expect(movs.some((m: any) => m.userId === sa.userId)).toBe(true);
    await app.close();
  });
});

describe("POST /api/admin/products/bulk-price (idempotente, transacional)", () => {
  it("aplica, replay mesma key, 409 payload diferente, RBAC/CSRF, validacao, auditoria/historico", async () => {
    const app = await buildAppAdmin();
    const sa = await makeAuthed("superadmin");
    const at = await makeAuthed("atendimento");
    const { product, variant } = await seedProductWithVariant({ physical: 5, reserved: 0, min: 0, priceCents: 10000 });

    const noCsrf = await app.inject({ method: "POST", url: "/api/admin/products/bulk-price", cookies: { aa_session: sa.token }, payload: { percent: 10, productIds: [product.id] } });
    expect([400,403,419]).toContain(noCsrf.statusCode);
    const noPerm = await app.inject({ method: "POST", url: "/api/admin/products/bulk-price", cookies: { aa_session: at.token }, headers: { "x-csrf-token": at.csrf }, payload: { percent: 10, productIds: [product.id] } });
    expect(noPerm.statusCode, noPerm.body).toBe(403);
    for (const bad of [0, -100, 501]) {
      const r = await app.inject({ method: "POST", url: "/api/admin/products/bulk-price", cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { percent: bad, productIds: [product.id] } });
      expect(r.statusCode, String(bad)+r.body).toBe(400);
    }

    const key = `bp-${RUN}-${Math.random().toString(36).slice(2)}`;
    const r1 = await app.inject({ method: "POST", url: "/api/admin/products/bulk-price", cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { percent: 10, productIds: [product.id], idempotencyKey: key } });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json().updated).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, variant.id)).limit(1))[0].priceCents).toBe(11000);

    const r2 = await app.inject({ method: "POST", url: "/api/admin/products/bulk-price", cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { percent: 10, productIds: [product.id], idempotencyKey: key } });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r2.json().replayed).toBe(true);
    expect((await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, variant.id)).limit(1))[0].priceCents).toBe(11000);

    const r3 = await app.inject({ method: "POST", url: "/api/admin/products/bulk-price", cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { percent: 20, productIds: [product.id], idempotencyKey: key } });
    expect(r3.statusCode, r3.body).toBe(409);

    const aud = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "product.bulk_price_change"));
    expect(aud.length).toBeGreaterThan(0);
    const hist = await db.select().from(schema.productChangeHistory).where(and(eq(schema.productChangeHistory.productId, product.id), eq(schema.productChangeHistory.field, "variant.bulk_price")));
    expect(hist.length).toBeGreaterThan(0);
    await app.close();
  });

  it("nenhum produto correspondente => 200, updated 0", async () => {
    const app = await buildAppAdmin();
    const sa = await makeAuthed("superadmin");
    const r = await app.inject({ method: "POST", url: "/api/admin/products/bulk-price", cookies: { aa_session: sa.token }, headers: { "x-csrf-token": sa.csrf }, payload: { percent: 10, productIds: ["00000000-0000-0000-0000-000000000000"] } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().updated).toBe(0);
    await app.close();
  });
});
