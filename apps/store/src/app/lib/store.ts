// language: TS, file: apps/store/src/app/lib/store.ts, target: Next.js App Router
// Cliente da API pública da loja. Tiposderivam do contrato de /api/store/*.

const isProd = process.env.NODE_ENV === "production";
const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const ABSOLUTE_API =
  envUrl && envUrl !== "http://localhost:4000"
    ? envUrl.replace(/\/+$/, "")
    : isProd
      ? "https://airsoftamericana-api.vercel.app"
      : "http://localhost:4000";

// Client components use relative paths so Next.js rewrites proxy to the API
// (same-origin cookies). Server components need the absolute URL.
export const API_URL = typeof window !== "undefined" ? "" : ABSOLUTE_API;
export const API_SERVER = ABSOLUTE_API;

export type StoreImage = {
  id: string;
  url: string;
  alt: string | null;
  kind: string;
  position: number;
};

export type StoreVariant = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  promoPriceCents: number | null;
  weightGrams: number;
  active: boolean;
  available: number;
};

export type StoreProduct = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  technicalDescription?: string;
  categoryId: string;
  brandId: string | null;
  ageRestricted: boolean;
  featured: boolean;
  condicao?: "novo" | "usado" | "seminovo" | string;
  estado_conservacao?: string | null;
  itens_inclusos?: string | null;
  garantia_dias?: number;
  unidade_unica?: boolean;
  tags?: string | null;
  createdAt: string;
  updatedAt?: string;
  publishedAt?: string | null;
  variants: StoreVariant[];
  images: StoreImage[];
  specs?: { id: string; key: string; label: string; value: string; position: number }[];
  brandName: string | null;
  brandSlug: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  parentCategoryName?: string | null;
  parentCategorySlug?: string | null;
  priceCents: number;
  listPriceCents: number;
  promoPriceCents: number | null;
  available: number;
  related?: StoreProduct[];
  compatible?: StoreProduct[];
  compatibleIds?: string[];
};

export type StoreCategoryNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description?: string;
  imageUrl?: string | null;
  ageRestricted: boolean;
  active: boolean;
  position: number;
  children?: StoreCategoryNode[];
};

export type StoreDepartment = {
  id: string;
  name: string;
  slug: string;
  description: string;
  imageUrl: string | null;
  ageRestricted: boolean;
  children: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    ageRestricted: boolean;
    children: { id: string; name: string; slug: string; ageRestricted: boolean }[];
  }[];
};

export type StoreBrand = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string;
  productCount: number;
};

export type StoreBanner = {
  id: string;
  title: string;
  subtitle: string;
  eyebrow: string;
  ctaLabel: string;
  imageDesktop: string | null;
  imageMobile: string | null;
  link: string | null;
  kind: string;
  active: boolean;
  position: number;
};

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

export type StoreHome = {
  banners: StoreBanner[];
  sections: {
    id: string;
    kind: string;
    title: string;
    subtitle: string;
    position: number;
    config: Record<string, unknown>;
  }[];
  departments: StoreDepartment[];
  brands: StoreBrand[];
  featured: StoreProduct[];
  news: StoreProduct[];
  sale: StoreProduct[];
  bestsellers: StoreProduct[];
  settings: CommercialSettings;
  totals: { products: number };
};

export type CatalogSpecFacet = {
  key: string;
  label: string;
  values: { value: string; count: number }[];
};

export type CatalogFacets = {
  brands: { id: string; slug: string; name: string; count: number }[];
  categories: { id: string; slug: string; name: string; count: number }[];
  price: { minCents: number; maxCents: number };
  conditions?: { key: string; count: number }[];
  specs?: CatalogSpecFacet[];
};

export type CatalogResult = {
  items: StoreProduct[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  facets: CatalogFacets;
};

export type StoreSuggestion = {
  products: { id: string; name: string; slug: string; imageUrl: string | null }[];
  categories: { id: string; name: string; slug: string }[];
  brands: { id: string; name: string; slug: string }[];
};

/** GET com tolerância a falha: vitrine nunca quebra por API fora do ar.
 *
 * Aceita caminho relativo ("/api/store/home") ou URL absoluta já montada
 * ("http://localhost:4000/api/store/home") — evita a URL duplicada que
 * engolia a falha e devolvia o objeto fallback vazio.
 */
/** Fetch com timeout para não travar o SSR (nem o cliente) quando a API não responde. */
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  ms = 8000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function storeGet<T>(path: string, fallback: T): Promise<T> {
  const url = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
  try {
    const res = await fetchWithTimeout(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[store] ${res.status} ${res.statusText} em ${url}`);
      return fallback;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[store] falha ao buscar ${url}:`, err);
    return fallback;
  }
}

export function formatBRL(cents: number | null | undefined): string {
  if (cents == null || cents === 0) return "";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Preço à vista no PIX — a condição vem do banco, nunca fixa na vitrine. */
export function pixPrice(priceCents: number, settings: Pick<CommercialSettings, "pix_discount_percent">): number {
  if (!priceCents) return 0;
  const percent = settings.pix_discount_percent ?? 0;
  return Math.floor(priceCents * (1 - percent / 100));
}

/** Parcelamento calculado a partir do preço e do mínimo configurado. */
export function installmentsFor(
  priceCents: number,
  settings: Pick<CommercialSettings, "installments" | "installment_interest_free" | "min_installment_cents">,
): { count: number; valueCents: number; interestFree: boolean } {
  const max = Math.max(1, settings.installments ?? 1);
  const min = settings.min_installment_cents ?? 0;
  let count = max;
  while (count > 1 && Math.ceil(priceCents / count) < min) count--;
  return {
    count,
    valueCents: count > 0 ? Math.ceil(priceCents / count) : 0,
    interestFree: settings.installment_interest_free !== false,
  };
}

export function productImage(product: {
  images?: StoreImage[] | null;
}): string | null {
  const first = product.images?.[0]?.url;
  return first && first.length > 0 ? first : null;
}
