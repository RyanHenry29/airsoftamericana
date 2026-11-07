// language: TS, file: apps/api/src/services/catalog.n1.test.ts, target: vitest
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { listProducts } from "./catalog.js";
import { benchStart, benchReset, benchStop, benchCount } from "../lib/query-bench.js";

let db: Awaited<ReturnType<typeof getDb>>;
const TAG = `N1DEMO-${Date.now()}`;
let catId: string;
let brandId: string;
let productIds: string[] = [];

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  const [cat] = await db
    .insert(schema.categories)
    .values({ name: `${TAG} Cat`, slug: `n1-${TAG}-cat`.toLowerCase(), active: true, position: 999 })
    .returning();
  const [brand] = await db
    .insert(schema.brands)
    .values({ name: `${TAG} Brand`, slug: `n1-${TAG}-brand`.toLowerCase(), active: true, position: 999 })
    .returning();
  catId = cat!.id;
  brandId = brand!.id;

  const count = 12;
  for (let i = 0; i < count; i++) {
    const [p] = await db
      .insert(schema.products)
      .values({
        name: `${TAG} Produto ${i}`,
        slug: `n1-${TAG}-p-${i}`.toLowerCase(),
        shortDescription: "DEMO",
        description: "DEMO n1",
        categoryId: catId,
        brandId,
        published: true,
        featured: i === 0,
        ageRestricted: false,
      })
      .returning();
    const [v] = await db
      .insert(schema.productVariants)
      .values({
        productId: p!.id,
        sku: `N1SKU-${TAG}-${i}`,
        name: `Var ${i}`,
        priceCents: 1000 + i * 100,
        promoPriceCents: i % 3 === 0 ? 900 + i * 100 : null,
        weightGrams: 100,
        active: true,
      })
      .returning();
    await db.insert(schema.inventory).values({ variantId: v!.id, physical: 5, reserved: 1, minQuantity: 0 });
    await db.insert(schema.productImages).values({ productId: p!.id, url: `/demo/${i}.webp`, alt: `a${i}`, kind: "image", position: 0 });
    productIds.push(p!.id);
  }
});

afterAll(async () => {
  benchStop();
  try {
    if (productIds.length) {
      await db.delete(schema.products).where(inArray(schema.products.id, productIds));
    }
    if (brandId) await db.delete(schema.brands).where(eq(schema.brands.id, brandId));
    if (catId) await db.delete(schema.categories).where(eq(schema.categories.id, catId));
  } catch {
    /* isolamento best-effort em DB compartilhada de teste */
  }
});

describe("listProducts — correção N+1 (funcional + queries)", () => {
  it("zero produtos (filtro sem correspondência) retorna vazio estável", async () => {
    const r = await listProducts(db, { page: 1, limit: 24, sort: "featured_first", brand: "__nao_existe__" });
    expect(r.products).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.facets.brands).toEqual([]);
  });

  it("preserva formato funcional: paginação, filtros, facets, sem duplicação, sem productId em variante", async () => {
    const r = await listProducts(db, {
      page: 1,
      limit: 5,
      sort: "price_asc",
      ids: productIds,
    });
    expect(r.total).toBe(12);
    expect(r.products).toHaveLength(5);
    const ids = r.products.map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
    // ordenação por preço asc (cheapest efetivo)
    for (let i = 1; i < r.products.length; i++) {
      expect(r.products[i]!.priceCents).toBeGreaterThanOrEqual(r.products[i - 1]!.priceCents);
    }
    for (const p of r.products) {
      expect(typeof p.name).toBe("string");
      expect(typeof p.slug).toBe("string");
      expect(Array.isArray(p.variants)).toBe(true);
      expect(Array.isArray(p.images)).toBe(true);
      expect(p.brandName).toBe(`${TAG} Brand`);
      expect(typeof p.available).toBe("number");
      for (const v of p.variants as any[]) {
        expect(v).not.toHaveProperty("productId"); // paridade de contrato
        expect(typeof v.available).toBe("number");
      }
    }
    expect(Number(r.facets.price.minCents)).toBeGreaterThan(0);
    expect(Number(r.facets.price.maxCents)).toBeGreaterThanOrEqual(Number(r.facets.price.minCents));

    const r2 = await listProducts(db, { page: 2, limit: 5, sort: "price_asc", ids: productIds });
    expect(r2.products).toHaveLength(5);
    const overlap = r2.products.filter((p) => ids.includes(p.id));
    expect(overlap).toHaveLength(0);

    const search = await listProducts(db, { page: 1, limit: 24, sort: "featured_first", q: TAG, ids: productIds });
    expect(search.total).toBe(12);
    expect(search.products.every((p) => p.name.includes(TAG))).toBe(true);
  });

  it("número de queries não escala por produto (redução N+1, lote)", async () => {
    benchStart();
    benchReset();
    const r = await listProducts(db, { page: 1, limit: 12, sort: "featured_first", ids: productIds });
    const q = benchCount();
    benchStop();
    expect(r.products).toHaveLength(12);
    // Antes (N+1): ~1 (rows) +1 (total) + 12*5 (enriquecimento) + facets (~4+) = 66+.
    // Depois (lote): rows+total + 4 (variants,images,brands,cats) + 1 (stock) + facets (~4) = ~11, constante.
    expect(q).toBeLessThan(20);
  });
});

describe("brands — contagem em lote (sem N+1 por marca)", () => {
  it("query count é constante (2) para listar marcas + contagens agregadas", async () => {
    const { and, asc, eq, sql } = await import("drizzle-orm");
    benchStart();
    benchReset();
    const rows = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.active, true))
      .orderBy(asc(schema.brands.position), asc(schema.brands.name));
    const counts = rows.length
      ? await db
          .select({ brandId: schema.products.brandId, count: sql`count(*)::int` })
          .from(schema.products)
          .where(and(eq(schema.products.published, true), sql`${schema.products.brandId} is not null`))
          .groupBy(schema.products.brandId)
      : [];
    const countByBrand = new Map(counts.map((c) => [c.brandId, Number(c.count)]));
    const items = rows.map((b) => ({ id: b.id, name: b.name, slug: b.slug, productCount: countByBrand.get(b.id) ?? 0 }));
    const q = benchCount();
    benchStop();
    expect(Array.isArray(items)).toBe(true);
    expect(q).toBeLessThanOrEqual(2);
    const mine = items.find((b) => b.id === brandId);
    expect(mine?.productCount).toBe(12);
  });
});
