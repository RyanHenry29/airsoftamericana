// language: TS, file: apps/api/src/services/catalog.search.test.ts, target: vitest
// Busca do catálogo: fold de acento (JS + banco), AND entre termos, marca e
// categoria via EXISTS, tags, ranking de relevância e suggestions dobradas.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { listProducts, fold } from "./catalog.js";
import { searchSuggestions } from "./homepage.js";

let db: Awaited<ReturnType<typeof getDb>>;
const TAG = `buscatest${Date.now()}`;

let catComumId = "";
let catAcaoId = "";
let brandComumId = "";
let brandAcaoId = "";
const productIds: string[] = [];
const byName = new Map<string, string>();
let skuSeq = 0;

async function insertProduct(opts: {
  name: string;
  categoryId: string;
  brandId: string;
  featured?: boolean;
  tags?: string;
}): Promise<string> {
  const [p] = await db
    .insert(schema.products)
    .values({
      name: opts.name,
      slug: `busca-${TAG}-${skuSeq}`.toLowerCase(),
      shortDescription: "DEMO busca",
      description: "DEMO busca catalogo",
      categoryId: opts.categoryId,
      brandId: opts.brandId,
      published: true,
      featured: opts.featured ?? false,
      ageRestricted: false,
      tags: opts.tags ?? "",
    })
    .returning();
  const [v] = await db
    .insert(schema.productVariants)
    .values({
      productId: p!.id,
      sku: `BUSCA-${TAG}-${skuSeq++}`,
      name: "Var",
      priceCents: 1000,
      promoPriceCents: null,
      weightGrams: 100,
      active: true,
    })
    .returning();
  await db.insert(schema.inventory).values({ variantId: v!.id, physical: 5, reserved: 0, minQuantity: 0 });
  productIds.push(p!.id);
  byName.set(opts.name, p!.id);
  return p!.id;
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);

  const [catComum] = await db
    .insert(schema.categories)
    .values({ name: `${TAG} Comum`, slug: `busca-${TAG}-comum`, active: true, position: 998 })
    .returning();
  const [catAcao] = await db
    .insert(schema.categories)
    .values({ name: `${TAG} Ação`, slug: `busca-${TAG}-acao`, active: true, position: 999 })
    .returning();
  const [brandComum] = await db
    .insert(schema.brands)
    .values({ name: `${TAG} Brand`, slug: `busca-${TAG}-brand`, active: true, position: 998 })
    .returning();
  const [brandAcao] = await db
    .insert(schema.brands)
    .values({ name: `${TAG} Ação Brand`, slug: `busca-${TAG}-acao-brand`, active: true, position: 999 })
    .returning();
  catComumId = catComum!.id;
  catAcaoId = catAcao!.id;
  brandComumId = brandComum!.id;
  brandAcaoId = brandAcao!.id;

  // P1: nome igual à consulta (rank 0). P2: nome que só contém (rank 1) e é
  // destaque — se a relevância não vencer o featured, P2 aparece antes de P1.
  await insertProduct({ name: `${TAG} Ação`, categoryId: catComumId, brandId: brandComumId });
  await insertProduct({ name: `${TAG} Ação Especial`, featured: true, categoryId: catComumId, brandId: brandComumId });
  await insertProduct({ name: `${TAG} Metal`, categoryId: catComumId, brandId: brandComumId });
  await insertProduct({ name: `${TAG} Tática Metal`, categoryId: catComumId, brandId: brandComumId });
  // P5/P6: o acento mora na categoria, não no nome do produto.
  await insertProduct({ name: `${TAG} Basico`, categoryId: catAcaoId, brandId: brandComumId });
  await insertProduct({ name: `${TAG} Só Categoria`, categoryId: catAcaoId, brandId: brandComumId });
  // P7: o acento mora na marca.
  await insertProduct({ name: `${TAG} Só Marca`, categoryId: catComumId, brandId: brandAcaoId });
  // P8: casa só pelas tags.
  await insertProduct({ name: `${TAG} Custom`, categoryId: catComumId, brandId: brandComumId, tags: "sniper, precisao" });
});

afterAll(async () => {
  try {
    if (productIds.length) await db.delete(schema.products).where(inArray(schema.products.id, productIds));
    if (catComumId) await db.delete(schema.categories).where(inArray(schema.categories.id, [catComumId, catAcaoId]));
    if (brandComumId) await db.delete(schema.brands).where(inArray(schema.brands.id, [brandComumId, brandAcaoId]));
  } catch {
    /* isolamento best-effort em DB compartilhada de teste */
  }
});

const ids = (r: { products: Array<{ id: string }> }) => r.products.map((p) => p.id);

describe("fold de acento", () => {
  it("fold JS: sem acento e minúsculo, sem perder dígitos", () => {
    expect(fold("AÇÃO ção M4A1")).toBe("acao cao m4a1");
  });

  it("'acao' encontra 'Ação' e a consulta acentuada encontra o mesmo conjunto", async () => {
    const base = { page: 1, limit: 50, sort: "featured_first" as const, ids: productIds };
    const plain = await listProducts(db, { ...base, q: `${TAG} acao` });
    const accented = await listProducts(db, { ...base, q: `${TAG} Ação` });
    expect(new Set(ids(plain))).toEqual(new Set(ids(accented)));
    // Quem casa: P1, P2 (nome), P5, P6 (categoria), P7 (marca).
    expect(new Set(ids(plain))).toEqual(
      new Set([
        byName.get(`${TAG} Ação`),
        byName.get(`${TAG} Ação Especial`),
        byName.get(`${TAG} Basico`),
        byName.get(`${TAG} Só Categoria`),
        byName.get(`${TAG} Só Marca`),
      ]),
    );
  });
});

describe("AND entre termos", () => {
  it("'metal tatica' retorna só quem tem os dois termos", async () => {
    const r = await listProducts(db, { page: 1, limit: 50, sort: "featured_first", q: `${TAG} metal tatica`, ids: productIds });
    expect(ids(r)).toEqual([byName.get(`${TAG} Tática Metal`)]);
    // Tem "metal", mas não "tatica" — fica de fora.
    expect(ids(r)).not.toContain(byName.get(`${TAG} Metal`));
  });

  it("consulta sem correspondência e consulta só com pontuação devolvem vazio", async () => {
    const none = await listProducts(db, { page: 1, limit: 50, sort: "featured_first", q: `${TAG} inexistente`, ids: productIds });
    expect(none.total).toBe(0);
    const junk = await listProducts(db, { page: 1, limit: 50, sort: "featured_first", q: "!!!", ids: productIds });
    expect(junk.total).toBe(0);
  });
});

describe("marca e categoria entram na busca (EXISTS correlacionado)", () => {
  it("'acao' acha produto cujo acento está só na categoria ou na marca", async () => {
    const r = await listProducts(db, { page: 1, limit: 50, sort: "featured_first", q: "acao", ids: productIds });
    expect(ids(r)).toContain(byName.get(`${TAG} Basico`)); // categoria "…Ação"
    expect(ids(r)).toContain(byName.get(`${TAG} Só Categoria`)); // categoria "…Ação"
    expect(ids(r)).toContain(byName.get(`${TAG} Só Marca`)); // marca "…Ação Brand"
    expect(ids(r)).not.toContain(byName.get(`${TAG} Metal`)); // nem nome, nem cat/marca
    expect(ids(r)).not.toContain(byName.get(`${TAG} Tática Metal`)); // "tática" ≠ "acao"
  });
});

describe("tags", () => {
  it("'sniper' encontra apenas o produto marcado", async () => {
    const r = await listProducts(db, { page: 1, limit: 50, sort: "featured_first", q: "sniper", ids: productIds });
    expect(ids(r)).toEqual([byName.get(`${TAG} Custom`)]);
  });
});

describe("ranking de relevância", () => {
  it("nome igual vence destaque: P1 antes de P2 mesmo com P2 featured", async () => {
    const r = await listProducts(db, { page: 1, limit: 50, sort: "featured_first", q: `${TAG} acao`, ids: productIds });
    expect(r.products[0]!.id).toBe(byName.get(`${TAG} Ação`));
    expect(r.products[1]!.id).toBe(byName.get(`${TAG} Ação Especial`));
  });

  it("sort de preço mantém o conjunto da busca (relevância não invade outro sort)", async () => {
    const r = await listProducts(db, { page: 1, limit: 50, sort: "price_asc", q: `${TAG} acao`, ids: productIds });
    expect(r.total).toBe(5);
    expect(ids(r).sort()).toEqual(
      [
        byName.get(`${TAG} Ação`),
        byName.get(`${TAG} Ação Especial`),
        byName.get(`${TAG} Basico`),
        byName.get(`${TAG} Só Categoria`),
        byName.get(`${TAG} Só Marca`),
      ].sort(),
    );
  });

  it("com filtro de preço (ramo DISTINCT) a busca segue íntegra", async () => {
    const r = await listProducts(db, { page: 1, limit: 50, sort: "featured_first", q: `${TAG} acao`, minPriceCents: 500, ids: productIds });
    expect(r.total).toBe(5);
    expect(r.products).toHaveLength(5);
  });
});

describe("suggestions dobradas", () => {
  it("sem acento e com caixa alta encontra produtos, categorias e marcas", async () => {
    for (const probe of [`${TAG} acao`, `${TAG} AÇÃO`, `${TAG} ação`]) {
      const sug = await searchSuggestions(db, probe);
      expect(sug.products.map((p) => p.id)).toContain(byName.get(`${TAG} Ação`));
      expect(sug.categories.map((c) => c.id)).toContain(catAcaoId);
      expect(sug.brands.map((b) => b.id)).toContain(brandAcaoId);
    }
  });
});
