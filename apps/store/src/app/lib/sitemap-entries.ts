// language: TS, file: apps/store/src/app/lib/sitemap-entries.ts, target: Next.js App Router (sitemap.xml)
// Montagem pura do sitemap — sem fetch, sem next: o vitest da raiz exercita as
// regras sem servidor. Regras do corte:
//   - URL aparece uma vez só (estáticos vêm primeiro e vencem duplicatas);
//   - lastmod SÓ quando a fonte tem data real (sem "agora" inventado);
//   - slug vazio não vira rota (o `/${slug}` vazio colidiria com a raiz);
//   - marca com zero produto fica de fora (página fina não entra no índice).

export type ChangeFreq = "daily" | "weekly" | "monthly" | "yearly";

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency: ChangeFreq;
  priority: number;
};

export type StaticRoute = { path: string; changeFrequency: ChangeFreq; priority: number };

export type ProductSource = {
  slug: string;
  updatedAt?: string | null;
  publishedAt?: string | null;
  createdAt?: string;
};

export type PostSource = { slug: string; publishedAt?: string | null; createdAt?: string };

export type BrandSource = { slug: string; productCount?: number };

/** Páginas fixas da loja. Só rota que existe em apps/store/src/app — nada de URL deduzida. */
export const STATIC_ROUTES: StaticRoute[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/catalogo", changeFrequency: "daily", priority: 0.9 },
  { path: "/guia", changeFrequency: "weekly", priority: 0.7 },
  { path: "/guia/primeiro-jogo", changeFrequency: "monthly", priority: 0.6 },
  { path: "/guia/escolher-primeira-aeg", changeFrequency: "monthly", priority: 0.6 },
  { path: "/guia/gbb-vs-hpa", changeFrequency: "monthly", priority: 0.6 },
  { path: "/blog", changeFrequency: "daily", priority: 0.7 },
  { path: "/frete", changeFrequency: "monthly", priority: 0.6 },
  { path: "/atendimento", changeFrequency: "monthly", priority: 0.5 },
  { path: "/institucional", changeFrequency: "monthly", priority: 0.5 },
  { path: "/por-que-comprar", changeFrequency: "monthly", priority: 0.5 },
  { path: "/rastreamento", changeFrequency: "yearly", priority: 0.4 },
  { path: "/termos", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacidade", changeFrequency: "yearly", priority: 0.3 },
];

/** Primeira data válida da ordem de preferência (updated > published > created). */
function firstValidDate(...values: (string | null | undefined)[]): Date | undefined {
  for (const v of values) {
    if (!v) continue;
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/** Normaliza base: sem barra no fim — `${base}/rota` nunca vira `//rota`. */
function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

export function buildSitemapEntries(input: {
  base: string;
  statics?: StaticRoute[];
  products?: ProductSource[];
  brands?: BrandSource[];
  posts?: PostSource[];
}): SitemapEntry[] {
  const base = normalizeBase(input.base);
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];

  const add = (path: string, meta: { lastModified?: Date; changeFrequency: ChangeFreq; priority: number }): void => {
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = `${base}${suffix}`;
    if (seen.has(url)) return;
    seen.add(url);
    const { lastModified, changeFrequency, priority } = meta;
    // Sem data real: a chave nem entra (lastModified: undefined não é ausência
    // para quem lê o objeto — e o teste cobre isso).
    out.push(
      lastModified
        ? { url, lastModified, changeFrequency, priority }
        : { url, changeFrequency, priority },
    );
  };

  // Estáticos primeiro: a rota fixa vence qualquer duplicata vinda do catálogo.
  for (const route of input.statics ?? STATIC_ROUTES) {
    add(route.path, { changeFrequency: route.changeFrequency, priority: route.priority });
  }

  for (const p of input.products ?? []) {
    const slug = (p.slug ?? "").trim().replace(/^\/+/, "");
    if (!slug) continue;
    add(`/${slug}`, {
      lastModified: firstValidDate(p.updatedAt, p.publishedAt, p.createdAt),
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  for (const b of input.brands ?? []) {
    // productCount === 0: página vazia fora do índice. indefinido: fonte não informou — entra.
    if (b.productCount === 0) continue;
    const slug = (b.slug ?? "").trim().replace(/^\/+/, "");
    if (!slug) continue;
    add(`/marca/${slug}`, { changeFrequency: "weekly", priority: 0.6 });
  }

  for (const post of input.posts ?? []) {
    const slug = (post.slug ?? "").trim().replace(/^\/+/, "");
    if (!slug) continue;
    add(`/blog/${slug}`, {
      lastModified: firstValidDate(post.publishedAt, post.createdAt),
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return out;
}
