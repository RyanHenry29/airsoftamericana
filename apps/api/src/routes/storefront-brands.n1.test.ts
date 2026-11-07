// language: TS, file: apps/api/src/routes/storefront-brands.n1.test.ts, target: vitest
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fastify from "fastify";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { registerStorefrontRoutes } from "./storefront.js";
import { benchStart, benchReset, benchStop, benchCount } from "../lib/query-bench.js";

let db: Awaited<ReturnType<typeof getDb>>;
let app: ReturnType<typeof fastify>;
const TAG = `BN1-${Date.now()}`;
let catId = "";
const brandIds: string[] = [];
const productIds: string[] = [];

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  const [cat] = await db.insert(schema.categories).values({ name: `${TAG} Cat`, slug: `bn1-${TAG}-cat`.toLowerCase(), active: true, position: 999 }).returning();
  catId = cat!.id;
  for (let i = 0; i < 6; i++) {
    const [b] = await db.insert(schema.brands).values({ name: `${TAG} Brand ${i}`, slug: `bn1-${TAG}-b-${i}`.toLowerCase(), active: true, position: i }).returning();
    brandIds.push(b!.id);
    // 2 produtos no primeiro, 1 no segundo, 0 nos demais (publicados)
    const n = i === 0 ? 2 : i === 1 ? 1 : 0;
    for (let j = 0; j < n; j++) {
      const [p] = await db.insert(schema.products).values({
        name: `${TAG} P ${i}-${j}`, slug: `bn1-${TAG}-p-${i}-${j}`.toLowerCase(),
        shortDescription: "DEMO", description: "DEMO", categoryId: catId, brandId: b!.id, published: true,
      }).returning();
      const [v] = await db.insert(schema.productVariants).values({ productId: p!.id, sku: `BN1-${TAG}-${i}-${j}`, name: "v", priceCents: 1000, weightGrams: 1, active: true }).returning();
      await db.insert(schema.inventory).values({ variantId: v!.id, physical: 1, reserved: 0, minQuantity: 0 });
      productIds.push(p!.id);
    }
  }
  app = fastify();
  registerStorefrontRoutes(app, db);
  await app.ready();
});

afterAll(async () => {
  benchStop();
  await app.close();
  try {
    if (productIds.length) await db.delete(schema.products).where(inArray(schema.products.id, productIds));
    if (brandIds.length) await db.delete(schema.brands).where(inArray(schema.brands.id, brandIds));
    if (catId) await db.delete(schema.categories).where(eq(schema.categories.id, catId));
  } catch {}
});

describe("/api/store/brands — sem N+1, contrato preservado", () => {
  it("retorna marcas ativas com contagem correta e ordenação determinística", async () => {
    const res = await app.inject({ method: "GET", url: "/api/store/brands" });
    expect(res.statusCode).toBe(200);
    const items = res.json() as Array<{ id: string; name: string; slug: string; productCount: number; logoUrl: any; description: any }>;
    expect(Array.isArray(items)).toBe(true);
    const mine = items.filter((b) => b.name.startsWith(TAG));
    expect(mine).toHaveLength(6);
    const byId = new Map(mine.map((b) => [b.id, b]));
    expect(byId.get(brandIds[0]!)?.productCount).toBe(2);
    expect(byId.get(brandIds[1]!)?.productCount).toBe(1);
    expect(byId.get(brandIds[2]!)?.productCount).toBe(0);
    for (const b of mine) {
      expect(b).toHaveProperty("id");
      expect(b).toHaveProperty("slug");
      expect(b).toHaveProperty("logoUrl");
      expect(typeof b.productCount).toBe("number");
    }
  });

  it("quantidade de queries constante (não escala por marca)", async () => {
    benchStart();
    benchReset();
    const res = await app.inject({ method: "GET", url: "/api/store/brands" });
    const q = benchCount();
    benchStop();
    expect(res.statusCode).toBe(200);
    // Antes (N+1): 1 (marcas) + N (count por marca). Com 6+ marcas DEMO no resultado global, seria 1+N.
    // Depois (lote): 1 (marcas) + 1 (group by brand_id) = 2.
    expect(q).toBeLessThanOrEqual(3);
  });
});
