// @ts-ignore - drizzle type overloads
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

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

  if (input.q) {
    const term = `%${input.q.trim()}%`;
    conditions.push(
      or(
        ilike(schema.products.name, term),
        ilike(schema.products.description, term),
        ilike(schema.products.shortDescription, term),
      )!,
    );
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
    conditions.push(ids.length > 0 ? inArray(schema.products.id, ids) : eq(schema.products.id, "__nomatch__"));
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

  const baseQuery = db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      slug: schema.products.slug,
      shortDescription: schema.products.shortDescription,
      description: schema.products.description,
      categoryId: schema.products.categoryId,
      brandId: schema.products.brandId,
      ageRestricted: schema.products.ageRestricted,
      featured: schema.products.featured,
      createdAt: schema.products.createdAt,
    })
    .from(schema.products)
    .where(whereSql);

  const rows = await (async () => {
    if (!variantWhere) {
      return baseQuery.limit(input.limit).offset(offset);
    }
    return db
      .selectDistinct({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        shortDescription: schema.products.shortDescription,
        description: schema.products.description,
        categoryId: schema.products.categoryId,
        brandId: schema.products.brandId,
        ageRestricted: schema.products.ageRestricted,
        featured: schema.products.featured,
        createdAt: schema.products.createdAt,
      })
      .from(schema.products)
      .innerJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
      .leftJoin(schema.inventory, eq(schema.inventory.variantId, schema.productVariants.id))
      .where(and(whereSql, variantWhere))
      .limit(input.limit)
      .offset(offset);
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

  // Facetas calculadas sobre o conjunto filtrado (sem paginação).
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
    },
  };
}

/** Detalhe completo do produto: galeria, ficha, relacionados e disponibilidade. */
export async function getProductBySlug(db: Db, slug: string) {
  const rows = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.slug, slug))
    .limit(1);
  const product = rows[0];
  if (!product) return null;

  const variants = await db
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, product.id));

  const stockRows = variants.length
    ? await db
        .select()
        .from(schema.inventory)
        .where(inArray(schema.inventory.variantId, variants.map((v) => v.id)))
    : [];

  const images = await db
    .select()
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, product.id))
    .orderBy(asc(schema.productImages.position));

  const specs = await db
    .select()
    .from(schema.productSpecs)
    .where(eq(schema.productSpecs.productId, product.id))
    .orderBy(asc(schema.productSpecs.position));

  const related = await db
    .select({ productId: schema.relatedProducts.relatedProductId })
    .from(schema.relatedProducts)
    .where(eq(schema.relatedProducts.productId, product.id))
    .orderBy(asc(schema.relatedProducts.position));

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

  const brand = product.brandId
    ? (await db.select().from(schema.brands).where(eq(schema.brands.id, product.brandId)).limit(1))[0]
    : undefined;

  const category = (
    await db.select().from(schema.categories).where(eq(schema.categories.id, product.categoryId)).limit(1)
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
  };
}

/** Ids dos produtos mais vendidos — usado pela vitrine "Mais vendidos". */
export async function topSellingProductIds(db: Db, limit: number): Promise<string[]> {
  return bestSellerIds(db, limit);
}
