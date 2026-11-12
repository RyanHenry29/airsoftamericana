// language: TS, file: apps/store/src/app/sitemap.ts, target: Next.js App Router (sitemap.xml)
// Sitemap completo: páginas estáticas + produtos paginados + marcas com produto
// + posts publicados. O contrato da API clampa o limit (produtos em 60, posts
// em 50) — o antigo `limit=1000` silenciosamente só pegava a primeira leva de
// produtos. Fonte fora do ar não derruba o XML: cada fonte cai para lista vazia
// e os estáticos seguem.
import type { MetadataRoute } from "next";
import { API_SERVER } from "./lib/store";
import {
  STATIC_ROUTES,
  buildSitemapEntries,
  type BrandSource,
  type PostSource,
  type ProductSource,
} from "./lib/sitemap-entries";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://airsoftamericana.vercel.app";

// Data Cache do Next: sitemap é pedido por crawler o dia inteiro — refetch a
// cada request queimava orçamento de função sem motivo.
const REVALIDATE_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 5000;

// Clamps das rotas da API (storefront.ts: Math.min(60, …), blog.ts: Math.min(50, …)).
const PRODUCT_PAGE_SIZE = 60;
const POST_PAGE_SIZE = 50;
const MAX_PRODUCT_PAGES = 50; // teto de segurança contra resposta corrompida
const MAX_POST_PAGES = 20;

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_SERVER}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // API fora do ar / timeout: fonte some, sitemap continua válido.
    return null;
  }
}

async function fetchAllProducts(): Promise<ProductSource[]> {
  const rows: ProductSource[] = [];
  for (let page = 1; page <= MAX_PRODUCT_PAGES; page++) {
    const data = await fetchJson<{ items?: ProductSource[]; pages?: number }>(
      `/api/store/products?limit=${PRODUCT_PAGE_SIZE}&page=${page}`,
    );
    if (!data?.items?.length) break;
    rows.push(...data.items);
    if (page >= (data.pages ?? 1)) break;
  }
  return rows;
}

async function fetchAllPosts(): Promise<PostSource[]> {
  const rows: PostSource[] = [];
  for (let page = 1; page <= MAX_POST_PAGES; page++) {
    const data = await fetchJson<{ posts?: PostSource[]; totalPages?: number }>(
      `/api/store/blog?limit=${POST_PAGE_SIZE}&page=${page}`,
    );
    if (!data?.posts?.length) break;
    rows.push(...data.posts);
    if (page >= (data.totalPages ?? 1)) break;
  }
  return rows;
}

const asArray = <T>(v: T[] | null): T[] => (Array.isArray(v) ? v : []);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, brands, posts] = await Promise.all([
    fetchAllProducts(),
    fetchJson<BrandSource[]>("/api/store/brands"),
    fetchAllPosts(),
  ]);

  const entries = buildSitemapEntries({
    base: BASE,
    statics: STATIC_ROUTES,
    products,
    brands: asArray(brands),
    posts,
  });

  return entries.map(({ url, lastModified, changeFrequency, priority }) => ({
    url,
    ...(lastModified ? { lastModified } : {}),
    changeFrequency,
    priority,
  }));
}
