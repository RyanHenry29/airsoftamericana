// @ts-ignore - drizzle type overloads
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

// ——— Busca textual ————————————————————————————————————————————————
// O banco aplica translate(lower(col)) com este mapa e casa com o termo dobrado
// aqui em JS: "ação" e "acao" viram a mesma string dos dois lados, sem depender
// da extensão unaccent estar instalada. Par a par: impossível desalinhar comprimento.
const FOLD_MAP: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ñ: "n", ç: "c",
};
const FOLD_FROM = Object.keys(FOLD_MAP).join("");
const FOLD_TO = Object.values(FOLD_MAP).join("");

/** Reduz para a forma sem acento e sem caixa — mesmo resultado de translate(lower(...)). */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "");
}

/** Escapa curingas do LIKE: termo "50%" vira busca literal, não coringa. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Coluna de texto na forma em que o banco compara: minúscula e sem acento. */
export function folded(column: SQLWrapper): SQL {
  return sql`translate(lower(${column}), ${FOLD_FROM}, ${FOLD_TO})`;
}

/**
 * Divide a consulta em termos: um por espaço, minúsculos, sem acento,
 * pontuação só nas bordas — "g&g" e "m4a1" ficam inteiros.
 */
export function searchTokens(q: string): string[] {
  return fold(q)
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((token) => token.length > 0);
}

/** Um termo precisa aparecer em algum campo: textos, tags, marca ou categoria. */
function tokenCondition(token: string): SQL {
  const term = `%${escapeLike(token)}%`;
  return or(
    sql`${folded(schema.products.name)} like ${term}`,
    sql`${folded(schema.products.shortDescription)} like ${term}`,
    sql`${folded(schema.products.description)} like ${term}`,
    sql`${folded(schema.products.tags)} like ${term}`,
    sql`exists (select 1 from ${schema.brands} where ${schema.brands.id} = ${schema.products.brandId} and ${folded(schema.brands.name)} like ${term})`,
    sql`exists (select 1 from ${schema.categories} where ${schema.categories.id} = ${schema.products.categoryId} and ${folded(schema.categories.name)} like ${term})`,
  )!;
}

/** Relevância da busca: igual (0) > começa com (1) > contém (2) > resto (3). */
function rankExpression(phrase: string): SQL {
  const name = folded(schema.products.name);
  const short = folded(schema.products.shortDescription);
  const desc = folded(schema.products.description);
  const starts = `${escapeLike(phrase)}%`;
  const contains = `%${escapeLike(phrase)}%`;
  return sql`case
    when ${name} = ${phrase} then 0
    when ${name} like ${starts} then 1
    when ${name} like ${contains} or ${short} like ${contains} or ${desc} like ${contains} then 2
    else 3 end`;
}

export type SortKey =
  | "featured_first"
  | "news"
  | "price_asc"
  | "price_desc"
  | "name_asc"
  | "bestsellers";

export type CatalogQuery = {
  category?: string;
  brand?: string;
  q?: string;
  sort?: SortKey;
  page: number;
  limit: number;
  minPriceCents?: number;
  maxPriceCents?: number;
  onlyAvailable?: boolean;
  specKey?: string;
  specValue?: string;
  ids?: string[];
  condicao?: "novo" | "usado" | "seminovo";
};

type VariantRow = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  promoPriceCents: number | null;
  weightGrams: number;
  active: boolean;
};

/** Preço efetivo de uma variante: promoção quando existe, senão lista. */
export function effectivePrice(v: { priceCents: number; promoPriceCents: number | null }): number {
  return v.promoPriceCents ?? v.priceCents;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Só compara com uma coluna uuid quando o valor realmente é um UUID. */
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Resolve slug ou id de categoria para os ids da SUBDÁRVORE.
 *
 * A taxonomia tem três níveis: um departamento ("airsoft") inclui as
 * categorias ("airsoft-armas-de-airsoft") e as subcategorias
 * ("airsoft-armas-de-airsoft-rifle-airsoft-hta"). Filtrar só pelo nível
 * direto escondia as subcategorias do filtro da vitrine.
 */
async function resolveCategoryIds(db: Db, category: string): Promise<string[] | undefined> {
  const found = await db
    .select({ id: schema.categories.id, parentId: schema.categories.parentId })
    .from(schema.categories)
    .where(
      isUuid(category)
        ? or(eq(schema.categories.slug, category), eq(schema.categories.id, category))
        : eq(schema.categories.slug, category),
    )
    .limit(1);
  const root = found[0];
  if (!root) return ["__nomatch__"];

  const all = await db
    .select({ id: schema.categories.id, parentId: schema.categories.parentId })
    .from(schema.categories);
  const childrenOf = new Map<string, string[]>();
  for (const row of all) {
    if (!row.parentId) continue;
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row.id);
    childrenOf.set(row.parentId, list);
  }

  const ids = [root.id];
  const queue = [root.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of childrenOf.get(current) ?? []) {
      ids.push(childId);
      queue.push(childId);
    }
  }
  return ids;
}

async function resolveBrandId(db: Db, brand: string): Promise<string | undefined> {
  const found = await db
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(
      isUuid(brand)
        ? or(eq(schema.brands.slug, brand), eq(schema.brands.id, brand))
        : eq(schema.brands.slug, brand),
    )
    .limit(1);
  return found[0]?.id ?? "__nomatch__";
}

/** Mais vendidos: soma de quantidade em order_items — venda real, não chute. */
async function bestSellerIds(db: Db, limit: number): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT oi.variant_id::text AS variant_id, sum(oi.quantity)::int AS sold
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('cancelado', 'reembolsado')
    GROUP BY oi.variant_id
    ORDER BY sold DESC
    LIMIT ${limit}
  `);
  const variantIds = (rows as unknown as { rows: { variant_id: string }[] }).rows.map((r) => r.variant_id);
  if (variantIds.length === 0) return [];
  const products = await db
    .select({ id: schema.products.id })
    .from(schema.productVariants)
    .where(inArray(schema.productVariants.id, variantIds));
  return products.map((p) => p.id);
}

/**
 * Lista produtos com filtros reais e devolve as facetas da mesma consulta —
 * contagem por marca e faixas de preço vêm do resultado filtrado, não do total.
 */
export async function listProducts(db: Db, input: CatalogQuery) {
  const conditions: SQL[] = [eq(schema.products.published, true)];

  if (input.ids && input.ids.length > 0) {
    conditions.push(inArray(schema.products.id, input.ids));
  }

  if (input.category) {
    const ids = await resolveCategoryIds(db, input.category);
    if (ids && ids[0] === "__nomatch__") conditions.push(sql`false`);
    else if (ids) conditions.push(inArray(schema.products.categoryId, ids));
  }

  if (input.brand) {
    const brandId = await resolveBrandId(db, input.brand);
    if (brandId === "__nomatch__") conditions.push(sql`false`);
    else if (brandId) conditions.push(eq(schema.products.brandId, brandId));
  }

  const rawQuery = input.q?.trim() ?? "";
  const tokens = rawQuery ? searchTokens(rawQuery) : [];
  if (rawQuery) {
    if (tokens.length === 0) {
      // Consulta sem nenhum termo utilizável (só pontuação): nada a casar.
      conditions.push(sql`false`);
    } else {
      // AND entre termos — todos precisam aparecer. Termos de 1 letra só entram
      // quando não há nenhum mais longo, senão a busca afoga em falso positivo.
      const meaningful = tokens.filter((token) => token.length >= 2);
      for (const token of meaningful.length > 0 ? meaningful : tokens) {
        conditions.push(tokenCondition(token));
      }
    }
  }

  if (input.specKey && input.specValue) {
    const matching = await db
      .select({ productId: schema.productSpecs.productId })
      .from(schema.productSpecs)
      .where(
        and(
          eq(schema.productSpecs.key, input.specKey),
          ilike(schema.productSpecs.value, `%${input.specValue}%`),
        ),
      );
    const ids = matching.map((m) => m.productId);
    conditions.push(ids.length > 0 ? inArray(schema.products.id, ids) : sql`false`);
  }

  if (input.condicao && ["novo", "usado", "seminovo"].includes(input.condicao)) {
    conditions.push(eq(schema.products.condicao, input.condicao));
  }

  const whereSql = and(...conditions) ?? sql`TRUE`;
  const offset = (input.page - 1) * input.limit;

  // Preço mínimo/máximo e disponibilidade são filtros de variante.
  const variantFilters: SQL[] = [];
  if (input.minPriceCents != null) {
    variantFilters.push(sql`coalesce(${schema.productVariants.promoPriceCents}, ${schema.productVariants.priceCents}) >= ${input.minPriceCents}`);
  }
  if (input.maxPriceCents != null) {
    variantFilters.push(sql`coalesce(${schema.productVariants.promoPriceCents}, ${schema.productVariants.priceCents}) <= ${input.maxPriceCents}`);
  }
  if (input.onlyAvailable) {
    variantFilters.push(
      sql`(${schema.inventory.physical} - ${schema.inventory.reserved}) > 0`,
    );
  }
  const variantWhere = variantFilters.length > 0 ? and(...variantFilters) : undefined;

  // Seleção pública explícita: NUNCA incluir costCents.
  const publicProductCols = {
    id: schema.products.id,
    name: schema.products.name,
    slug: schema.products.slug,
    shortDescription: schema.products.shortDescription,
    description: schema.products.description,
    technicalDescription: schema.products.technicalDescription,
    categoryId: schema.products.categoryId,
    brandId: schema.products.brandId,
    ageRestricted: schema.products.ageRestricted,
    featured: schema.products.featured,
    published: schema.products.published,
    condicao: schema.products.condicao,
    estado_conservacao: schema.products.estado_conservacao,
    itens_inclusos: schema.products.itens_inclusos,
    garantia_dias: schema.products.garantia_dias,
    unidade_unica: schema.products.unidade_unica,
    tags: schema.products.tags,
    createdAt: schema.products.createdAt,
    updatedAt: schema.products.updatedAt,
    publishedAt: schema.products.publishedAt,
  } as const;

  const baseQuery = db
    .select(publicProductCols)
    .from(schema.products)
    .where(whereSql);

  const minEffPrice = sql`(select min(coalesce(pv.promo_price_cents, pv.price_cents)) from ${schema.productVariants} pv where pv.product_id = ${schema.products.id} and pv.active = true)`;
  const sortExpr = (() => {
    switch (input.sort) {
      case "price_asc": return asc(minEffPrice);
      case "price_desc": return desc(minEffPrice);
      case "name_asc": return asc(schema.products.name);
      case "news": return desc(schema.products.createdAt);
      case "bestsellers": return desc(schema.products.featured);
      case "featured_first":
      default: return desc(schema.products.featured);
    }
  })();
  const sortExpr2 = input.sort === "featured_first" || input.sort === "bestsellers" ? desc(schema.products.createdAt) : asc(schema.products.id);

  // Relevância só quando q existe e a ordenação é a de destaque — em preço/nome
  // a ordem pedida pelo usuário pesa mais que a correspondência.
  const rankSql =
    tokens.length > 0 && (input.sort ?? "featured_first") === "featured_first"
      ? rankExpression(fold(rawQuery).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
      : undefined;
  const orderList: SQL[] = rankSql ? [rankSql, sortExpr, sortExpr2] : [sortExpr, sortExpr2];

  const rows = await (async () => {
    if (!variantWhere) {
      return baseQuery.orderBy(...orderList).limit(input.limit).offset(offset);
    }
    if (!rankSql) {
      return db
        .selectDistinct(publicProductCols)
        .from(schema.products)
        .innerJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
        .leftJoin(schema.inventory, eq(schema.inventory.variantId, schema.productVariants.id))
        .where(and(whereSql, variantWhere))
        .orderBy(...orderList)
        .limit(input.limit)
        .offset(offset);
    }
    // Com DISTINCT o PG exige ORDER BY no select list (42P10) — a relevância
    // entra como coluna oculta e sai do resultado antes de virar produto.
    const ranked = await db
      .selectDistinct({ ...publicProductCols, __rank: rankSql.as("__rank") })
      .from(schema.products)
      .innerJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
      .leftJoin(schema.inventory, eq(schema.inventory.variantId, schema.productVariants.id))
      .where(and(whereSql, variantWhere))
      .orderBy(sql`__rank`, ...orderList.slice(1))
      .limit(input.limit)
      .offset(offset);
    return ranked.map((row) => {
      const { __rank, ...rest } = row;
      void __rank;
      return rest;
    });
  })();

  const totalResult = await db.select({ count: sql`count(*)` }).from(schema.products).where(whereSql);
  const total = Number(totalResult[0]?.count ?? 0);

  // Enriquecimento em lote (evita N+1 por produto): variantes, estoque, imagens, marcas, categorias.
  const productIds = rows.map((p) => p.id);
  const [allVariants, allImages, allBrands, allCategories] = await Promise.all([
    productIds.length
      ? db
          .select({
            id: schema.productVariants.id,
            productId: schema.productVariants.productId,
            sku: schema.productVariants.sku,
            name: schema.productVariants.name,
            priceCents: schema.productVariants.priceCents,
            promoPriceCents: schema.productVariants.promoPriceCents,
            weightGrams: schema.productVariants.weightGrams,
            active: schema.productVariants.active,
          })
          .from(schema.productVariants)
          .where(inArray(schema.productVariants.productId, productIds))
      : Promise.resolve([] as Array<VariantRow & { productId: string }>),
    productIds.length
      ? db
          .select({
            id: schema.productImages.id,
            productId: schema.productImages.productId,
            url: schema.productImages.url,
            alt: schema.productImages.alt,
            kind: schema.productImages.kind,
            position: schema.productImages.position,
          })
          .from(schema.productImages)
          .where(inArray(schema.productImages.productId, productIds))
          .orderBy(asc(schema.productImages.position))
      : Promise.resolve([] as Array<{ id: string; productId: string; url: string; alt: string | null; kind: string; position: number }>),
    (() => {
      const ids = [...new Set(rows.map((p) => p.brandId).filter((x): x is string => !!x))];
      return ids.length
        ? db.select({ id: schema.brands.id, name: schema.brands.name, slug: schema.brands.slug }).from(schema.brands).where(inArray(schema.brands.id, ids))
        : Promise.resolve([] as Array<{ id: string; name: string; slug: string }>);
    })(),
    (() => {
      const ids = [...new Set(rows.map((p) => p.categoryId).filter((x): x is string => !!x))];
      return ids.length
        ? db.select({ id: schema.categories.id, name: schema.categories.name, slug: schema.categories.slug }).from(schema.categories).where(inArray(schema.categories.id, ids))
        : Promise.resolve([] as Array<{ id: string; name: string; slug: string }>);
    })(),
  ]);

  const variantIds = allVariants.map((v) => v.id);
  const allStock = variantIds.length
    ? await db
        .select({ variantId: schema.inventory.variantId, physical: schema.inventory.physical, reserved: schema.inventory.reserved })
        .from(schema.inventory)
        .where(inArray(schema.inventory.variantId, variantIds))
    : [];

  const variantsByProduct = new Map<string, Array<VariantRow & { productId: string }>>();
  for (const v of allVariants) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }
  const stockByVariant = new Map(allStock.map((s) => [s.variantId, s]));
  const imagesByProduct = new Map<string, typeof allImages>();
  for (const img of allImages) {
    const list = imagesByProduct.get(img.productId) ?? [];
    list.push(img);
    imagesByProduct.set(img.productId, list);
  }
  for (const list of imagesByProduct.values()) list.sort((a, b) => a.position - b.position);
  const brandById = new Map(allBrands.map((b) => [b.id, b]));
  const categoryById = new Map(allCategories.map((c) => [c.id, c]));

  const items = rows.map((product) => {
    const variants = variantsByProduct.get(product.id) ?? [];
    const images = (imagesByProduct.get(product.id) ?? []).map(({ productId: _pid, ...rest }) => rest);
    const brand = product.brandId ? brandById.get(product.brandId) : undefined;
    const category = categoryById.get(product.categoryId);
    const viewVariants: (VariantRow & { available: number })[] = variants.map((v) => {
      const stock = stockByVariant.get(v.id);
      const { productId: _pid, ...rest } = v as VariantRow & { productId: string };
      return { ...rest, available: stock ? stock.physical - stock.reserved : 0 };
    });
    const cheapest = viewVariants
      .filter((v) => v.active)
      .reduce<VariantRow | null>(
        (acc, v) => (acc === null || effectivePrice(v) < effectivePrice(acc) ? v : acc),
        null,
      );
    return {
      ...product,
      variants: viewVariants,
      images,
      brandName: brand?.name ?? null,
      brandSlug: brand?.slug ?? null,
      categoryName: category?.name ?? null,
      categorySlug: category?.slug ?? null,
      priceCents: cheapest ? effectivePrice(cheapest) : 0,
      listPriceCents: cheapest?.priceCents ?? 0,
      promoPriceCents: cheapest?.promoPriceCents ?? null,
      available: viewVariants.reduce((a, v) => a + v.available, 0),
    };
  });

  // Facetas calculadas sobre o conjunto filtrado (sem pagina??o), dados reais.
  const facetRows = await db
    .select({
      brandId: schema.products.brandId,
      count: sql`count(*)::int`,
    })
    .from(schema.products)
    .where(whereSql)
    .groupBy(schema.products.brandId);

  const facetBrandIds = facetRows.map((f) => f.brandId).filter((x): x is string => !!x);
  const facetBrands = facetBrandIds.length
    ? await db.select({ id: schema.brands.id, slug: schema.brands.slug, name: schema.brands.name }).from(schema.brands).where(inArray(schema.brands.id, facetBrandIds))
    : [];
  const facetBrandById = new Map(facetBrands.map((b) => [b.id, b]));
  const brandFacets = facetRows
    .filter((f) => f.brandId)
    .map((f) => {
      const brand = facetBrandById.get(f.brandId!);
      return brand ? { id: brand.id, slug: brand.slug, name: brand.name, count: Number(f.count) } : null;
    });

  const priceRows = await db
    .select({
      min: sql`min(coalesce(${schema.productVariants.promoPriceCents}, ${schema.productVariants.priceCents}))::int`,
      max: sql`max(coalesce(${schema.productVariants.promoPriceCents}, ${schema.productVariants.priceCents}))::int`,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(whereSql);

  const categoryFacets = await db
    .select({
      id: schema.categories.id,
      slug: schema.categories.slug,
      name: schema.categories.name,
      count: sql`count(${schema.products.id})::int`,
    })
    .from(schema.categories)
    .leftJoin(schema.products, eq(schema.products.categoryId, schema.categories.id))
    .where(and(whereSql, sql`${schema.categories.parentId} is not null`))
    .groupBy(schema.categories.id)
    .orderBy(desc(sql`count(${schema.products.id})`));

  // Condi??o (real): contagem por condicao no escopo filtrado
  const condRows = await db
    .select({ condicao: schema.products.condicao, count: sql`count(*)::int` })
    .from(schema.products)
    .where(whereSql)
    .groupBy(schema.products.condicao);
  const condicaoFacets = condRows
    .map((r) => ({ key: String(r.condicao ?? "novo"), count: Number(r.count) }))
    .filter((r) => r.count > 0);

  // Especificações técnicas configuráveis (real): specs distintas no escopo filtrado
  let specFacets: Array<{ key: string; label: string; values: Array<{ value: string; count: number }> }> = [];
  try {
    const specRows = await db
      .select({
        key: schema.productSpecs.key,
        label: schema.productSpecs.label,
        value: schema.productSpecs.value,
        count: sql<number>`count(distinct ${schema.productSpecs.productId})::int`,
      })
      .from(schema.productSpecs)
      .innerJoin(schema.products, eq(schema.productSpecs.productId, schema.products.id))
      .where(whereSql)
      .groupBy(schema.productSpecs.key, schema.productSpecs.label, schema.productSpecs.value)
      .orderBy(asc(schema.productSpecs.key), desc(sql`count(distinct ${schema.productSpecs.productId})`), asc(schema.productSpecs.value))
      .limit(400);
    const byKey = new Map<string, { key: string; label: string; values: Array<{ value: string; count: number }> }>();
    for (const r of specRows) {
      if (!r?.key || !r?.value) continue;
      const k = String(r.key);
      const g = byKey.get(k) ?? { key: k, label: String(r.label ?? r.key), values: [] };
      if (!g.label && r.label) g.label = String(r.label);
      if (!g.values.some((v) => v.value === String(r.value))) g.values.push({ value: String(r.value), count: Number(r.count ?? 0) });
      byKey.set(k, g);
    }
    specFacets = [...byKey.values()].map((g) => ({ ...g, values: g.values.slice(0, 20) })).slice(0, 12);
  } catch {
    specFacets = [];
  }

  return {
    products: items,
    total,
    facets: {
      brands: brandFacets.filter((b): b is NonNullable<typeof b> => b !== null),
      categories: categoryFacets,
      price: {
        minCents: priceRows[0]?.min ?? 0,
        maxCents: priceRows[0]?.max ?? 0,
      },
      conditions: condicaoFacets,
      specs: specFacets,
    },
  };
}

/** Remove campos internos (ex.: custo) de qualquer objeto de produto público. */
function stripInternalProduct<T extends Record<string, unknown>>(p: T): Omit<T, "costCents" | "cost_cents"> {
  const { costCents, cost_cents, ...rest } = p as any;
  return rest;
}

/** Detalhe completo do produto: galeria, ficha, relacionados, compatíveis e disponibilidade. */
export async function getProductBySlug(db: Db, slug: string) {
  const rows = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.slug, slug))
    .limit(1);
  const raw = rows[0];
  if (!raw) return null;
  const product = stripInternalProduct(raw as Record<string, unknown>);

  const variants = await db
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, raw.id));

  const stockRows = variants.length
    ? await db
        .select()
        .from(schema.inventory)
        .where(inArray(schema.inventory.variantId, variants.map((v) => v.id)))
    : [];

  const images = await db
    .select()
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, raw.id))
    .orderBy(asc(schema.productImages.position));

  const specs = await db
    .select()
    .from(schema.productSpecs)
    .where(eq(schema.productSpecs.productId, raw.id))
    .orderBy(asc(schema.productSpecs.position));

  const related = await db
    .select({ productId: schema.relatedProducts.relatedProductId })
    .from(schema.relatedProducts)
    .where(eq(schema.relatedProducts.productId, raw.id))
    .orderBy(asc(schema.relatedProducts.position));

  let compatible: Array<{ productId: string }> = [];
  try {
    compatible = await db
      .select({ productId: schema.compatibleProducts.compatibleProductId })
      .from(schema.compatibleProducts)
      .where(eq(schema.compatibleProducts.productId, raw.id))
      .orderBy(asc(schema.compatibleProducts.position));
  } catch {
    compatible = [];
  }

  const relatedProducts = related.length
    ? await db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          slug: schema.products.slug,
          ageRestricted: schema.products.ageRestricted,
        })
        .from(schema.products)
        .where(inArray(schema.products.id, related.map((r) => r.productId)))
    : [];

  const relatedImages = relatedProducts.length
    ? await db
        .select({ productId: schema.productImages.productId, url: schema.productImages.url })
        .from(schema.productImages)
        .where(inArray(schema.productImages.productId, relatedProducts.map((r) => r.id)))
    : [];

  const brand = raw.brandId
    ? (await db.select().from(schema.brands).where(eq(schema.brands.id, raw.brandId)).limit(1))[0]
    : undefined;

  const category = (
    await db.select().from(schema.categories).where(eq(schema.categories.id, raw.categoryId)).limit(1)
  )[0];

  const parent = category?.parentId
    ? (await db.select().from(schema.categories).where(eq(schema.categories.id, category.parentId)).limit(1))[0]
    : undefined;

  const viewVariants = variants.map((v) => {
    const stock = stockRows.find((s) => s.variantId === v.id);
    return { ...v, available: stock ? stock.physical - stock.reserved : 0 };
  });

  const cheapest = viewVariants
    .filter((v) => v.active)
    .reduce<typeof viewVariants[number] | null>(
      (acc, v) => (acc === null || effectivePrice(v) < effectivePrice(acc) ? v : acc),
      null,
    );

  return {
    product: {
      ...product,
      variants: viewVariants,
      images,
      specs,
      brandName: brand?.name ?? null,
      brandSlug: brand?.slug ?? null,
      categoryName: category?.name ?? null,
      categorySlug: category?.slug ?? null,
      parentCategoryName: parent?.name ?? null,
      parentCategorySlug: parent?.slug ?? null,
      priceCents: cheapest ? effectivePrice(cheapest) : 0,
      listPriceCents: cheapest?.priceCents ?? 0,
      promoPriceCents: cheapest?.promoPriceCents ?? null,
      available: viewVariants.reduce((a, v) => a + v.available, 0),
      totalWeightGrams: viewVariants.reduce((a, v) => a + v.weightGrams, 0),
    },
    related: relatedProducts.map((r) => ({
      ...r,
      imageUrl: relatedImages.find((i) => i.productId === r.id)?.url ?? null,
    })),
    compatibleIds: compatible.map((c) => c.productId),
  };
}

/** Ids dos produtos mais vendidos — usado pela vitrine "Mais vendidos". */
export async function topSellingProductIds(db: Db, limit: number): Promise<string[]> {
  return bestSellerIds(db, limit);
}
