// @ts-ignore - drizzle type overloads
import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { listProducts, type SortKey } from "./catalog.js";

type SettingsRow = { key: string; value: unknown };

export type CommercialSettings = {
  pix_discount_percent: number;
  installments: number;
  installment_interest_free: boolean;
  min_installment_cents: number;
  free_shipping_from_cents: number;
  shipping_carriers: string[];
  whatsapp: string;
  email: string;
  address: {
    street: string;
    district: string;
    city: string;
    state: string;
    zip: string;
  };
  service_hours: string;
  social: { instagram: string; whatsapp: string };
  announcement: string;
};

const DEFAULT_COMMERCIAL: CommercialSettings = {
  pix_discount_percent: 0,
  installments: 1,
  installment_interest_free: false,
  min_installment_cents: 0,
  free_shipping_from_cents: 0,
  shipping_carriers: [],
  whatsapp: "",
  email: "",
  address: { street: "", district: "", city: "", state: "", zip: "" },
  service_hours: "",
  social: { instagram: "", whatsapp: "" },
  announcement: "",
};

/** Condições comerciais vêm do banco — o admin edita, a loja nunca inventa. */
export async function getCommercialSettings(db: Db): Promise<CommercialSettings> {
  const rows = await db.select().from(schema.systemSettings);
  const commercial = rows.find((r) => r.key === "commercial");
  if (!commercial) return DEFAULT_COMMERCIAL;
  const value = commercial.value;
  if (!value || typeof value !== "object") return DEFAULT_COMMERCIAL;
  const parsed = value as Partial<CommercialSettings>;
  return {
    ...DEFAULT_COMMERCIAL,
    ...parsed,
    address: { ...DEFAULT_COMMERCIAL.address, ...(parsed.address ?? {}) },
    social: { ...DEFAULT_COMMERCIAL.social, ...(parsed.social ?? {}) },
  };
}

async function hydrate(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  const result = await listProducts(db, { ids, page: 1, limit: ids.length, sort: "featured_first" });
  const order = new Map(ids.map((id, index) => [id, index]));
  return result.products
    .slice()
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Payload da homepage — cada seção é alimentada por dado real e configurável.
 * A ordem e a ativação vêm de homepage_sections.
 */
export async function buildHome(db: Db) {
  const now = new Date();

  const bannerRows = await db
    .select()
    .from(schema.banners)
    .where(eq(schema.banners.active, true))
    .orderBy(asc(schema.banners.position));

  const banners = bannerRows.filter((b) => {
    if (b.startsAt && b.startsAt > now) return false;
    if (b.endsAt && b.endsAt < now) return false;
    return true;
  });

  const sections = await db
    .select()
    .from(schema.homepageSections)
    .where(eq(schema.homepageSections.active, true))
    .orderBy(asc(schema.homepageSections.position));

  const [categories, brands, settings] = await Promise.all([
    db.select().from(schema.categories).where(eq(schema.categories.active, true)).orderBy(asc(schema.categories.position)),
    db.select().from(schema.brands).where(eq(schema.brands.active, true)).orderBy(asc(schema.brands.position)),
    getCommercialSettings(db),
  ]);

  const roots = categories.filter((c) => !c.parentId);
  const departments = roots.map((root) => ({
    id: root.id,
    name: root.name,
    slug: root.slug,
    description: root.description,
    imageUrl: root.imageUrl,
    ageRestricted: root.ageRestricted,
    children: categories
      .filter((c) => c.parentId === root.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        imageUrl: c.imageUrl,
        ageRestricted: c.ageRestricted,
        children: categories
          .filter((g) => g.parentId === c.id)
          .map((g) => ({ id: g.id, name: g.name, slug: g.slug, ageRestricted: g.ageRestricted })),
      })),
  }));

  // Vitrines
  const featured = await listProducts(db, { page: 1, limit: 8, sort: "featured_first" });
  const news = await listProducts(db, { page: 1, limit: 8, sort: "news" });

  const saleRows = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .innerJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
    .where(
      and(
        eq(schema.products.published, true),
        sql`${schema.productVariants.promoPriceCents} is not null`,
      ),
    )
    .groupBy(schema.products.id)
    .limit(8);
  const sale = await hydrate(db, saleRows.map((r) => r.id));

  // Mais vendidos: por venda real. Sem venda, a vitrine não inventa ranking.
  const bestRows = await db.execute(sql`
    SELECT p.id::text AS id, sum(oi.quantity)::int AS sold
    FROM order_items oi
    JOIN product_variants pv ON pv.id = oi.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status NOT IN ('cancelado', 'reembolsado') AND p.published = true
    GROUP BY p.id
    ORDER BY sold DESC
    LIMIT 8
  `);
  const bestIds = (bestRows as unknown as { rows: { id: string }[] }).rows.map((r) => r.id);
  const bestsellers = await hydrate(db, bestIds);

  const brandViews = await Promise.all(
    brands.map(async (brand) => {
      const products = await db
        .select({ count: count() })
        .from(schema.products)
        .where(and(eq(schema.products.brandId, brand.id), eq(schema.products.published, true)));
      return {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        logoUrl: brand.logoUrl,
        description: brand.description,
        productCount: Number(products[0]?.count ?? 0),
      };
    }),
  );

  return {
    banners,
    sections: sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      subtitle: s.subtitle,
      position: s.position,
      config: (s.config ?? {}) as Record<string, unknown>,
    })),
    departments,
    brands: brandViews,
    featured: featured.products,
    news: news.products,
    sale,
    bestsellers,
    settings,
    totals: {
      products: featured.total,
    },
  };
}

/** Sugestões rápidas da busca: produtos, categorias e marcas. */
export async function searchSuggestions(db: Db, term: string) {
  const q = term.trim();
  if (q.length < 2) return { products: [], categories: [], brands: [] };

  const products = await db
    .select({
      id: schema.products.id,
      name: schema.products.name,
      slug: schema.products.slug,
      ageRestricted: schema.products.ageRestricted,
    })
    .from(schema.products)
    .where(and(eq(schema.products.published, true), ilike(schema.products.name, `%${q}%`)))
    .limit(6);

  const productImages = products.length
    ? await db
        .select({ productId: schema.productImages.productId, url: schema.productImages.url })
        .from(schema.productImages)
        .where(sql`${schema.productImages.productId} in (${sql.join(
          products.map((p) => sql`${p.id}`),
          sql`, `,
        )})`)
    : [];

  const categories = await db
    .select({ id: schema.categories.id, name: schema.categories.name, slug: schema.categories.slug })
    .from(schema.categories)
    .where(and(eq(schema.categories.active, true), ilike(schema.categories.name, `%${q}%`)))
    .limit(4);

  const brands = await db
    .select({ id: schema.brands.id, name: schema.brands.name, slug: schema.brands.slug })
    .from(schema.brands)
    .where(and(eq(schema.brands.active, true), ilike(schema.brands.name, `%${q}%`)))
    .limit(4);

  return {
    products: products.map((p) => ({
      ...p,
      imageUrl: productImages.find((i) => i.productId === p.id)?.url ?? null,
    })),
    categories,
    brands,
  };
}
