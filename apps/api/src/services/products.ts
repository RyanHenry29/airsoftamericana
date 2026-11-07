// @ts-ignore - drizzle type overloads
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export async function listProducts(db: Db, input: {
  category?: string;
  brand?: string;
  q?: string;
  sort?: "price_asc" | "price_desc" | "featured_first" | "news";
  page: number;
  limit: number;
}) {
  // Resolve slug/id -> id for category and brand
  let categoryId: string | undefined;
  if (input.category) {
    const found = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(or(eq(schema.categories.slug, input.category), eq(schema.categories.id, input.category)))
      .limit(1);
    categoryId = found[0]?.id ?? "__nomatch__";
  }

  let brandId: string | undefined;
  if (input.brand) {
    const found = await db
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(or(eq(schema.brands.slug, input.brand), eq(schema.brands.id, input.brand)))
      .limit(1);
    brandId = found[0]?.id ?? "__nomatch__";
  }

  const conditions: SQL[] = [eq(schema.products.published, true)];
  if (categoryId) conditions.push(eq(schema.products.categoryId, categoryId));
  if (brandId) conditions.push(eq(schema.products.brandId, brandId));
  if (input.q) conditions.push(ilike(schema.products.name, `%${input.q}%`));
  const whereSql = and(...conditions) ?? sql`TRUE`;

  const offset = (input.page - 1) * input.limit;

  const minPriceSub = db
    .select({
      productId: schema.productVariants.productId,
      minPrice: sql<number>`min(${schema.productVariants.priceCents})`,
    })
    .from(schema.productVariants)
    .groupBy(schema.productVariants.productId)
    .as("mp");

  const orderBy =
    input.sort === "price_asc"
      ? asc(sql`mp.min_price`)
      : input.sort === "price_desc"
        ? desc(sql`mp.min_price`)
        : input.sort === "news"
          ? desc(schema.products.createdAt)
          : desc(schema.products.featured);

  // @ts-ignore - drizzle type overload mismatch
  const rows = await db.select({
    productId: schema.products.id,
    name: schema.products.name,
    slug: schema.products.slug,
    description: schema.products.description,
    ageRestricted: schema.products.ageRestricted,
    featured: schema.products.featured,
    categoryId: schema.products.categoryId,
    brandId: schema.products.brandId,
    minPrice: minPriceSub.minPrice,
  })
    .from(schema.products)
    .leftJoin(minPriceSub, eq(schema.products.id, minPriceSub.productId))
    .where(whereSql)
    .orderBy(orderBy)
    .limit(input.limit)
    .offset(offset);

  // @ts-ignore - drizzle type overload mismatch
  const totalResult = await db.select({ count: sql`count(*)` }).from(schema.products).where(whereSql);
  const total = Number(totalResult[0]?.count ?? 0);

  // Enrich with variant info
  const enriched = await Promise.all(rows.map(async (product) => {
    const productId = product.productId;
    if (!productId) return product;

    const variants = await db.select({
      id: schema.productVariants.id,
      sku: schema.productVariants.sku,
      name: schema.productVariants.name,
      priceCents: schema.productVariants.priceCents,
      promoPriceCents: schema.productVariants.promoPriceCents,
      weightGrams: schema.productVariants.weightGrams,
      active: schema.productVariants.active,
    })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, productId));

    const images = await db.select({
      id: schema.productImages.id,
      url: schema.productImages.url,
      alt: schema.productImages.alt,
    })
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, productId));

    return {
      ...product,
      variants: variants.length > 0 ? variants : [],
      images: images.length > 0 ? images : [],
    };
  }));

  return { products: enriched, total };
}

export async function getProductBySlug(db: Db, slug: string) {
  // @ts-ignore - drizzle type overload
  const productRows = await db.select({
    id: schema.products.id,
    name: schema.products.name,
    slug: schema.products.slug,
    description: schema.products.description,
    ageRestricted: schema.products.ageRestricted,
    featured: schema.products.featured,
    published: schema.products.published,
  })
    .from(schema.products)
    .where(eq(schema.products.slug, slug));

  if (productRows.length === 0) {
    return null;
  }

  const product = productRows[0];
  if (!product) return null;

  const variants = await db.select({
    id: schema.productVariants.id,
    sku: schema.productVariants.sku,
    name: schema.productVariants.name,
    priceCents: schema.productVariants.priceCents,
    promoPriceCents: schema.productVariants.promoPriceCents,
    weightGrams: schema.productVariants.weightGrams,
    active: schema.productVariants.active,
  })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, product.id));

  const images = await db.select({
    id: schema.productImages.id,
    url: schema.productImages.url,
    alt: schema.productImages.alt,
  })
    .from(schema.productImages)
    .where(eq(schema.productImages.productId, product.id));

  return { product: { ...product, variants, images } };
}