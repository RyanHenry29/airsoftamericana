// language: TSX, file: apps/store/src/app/sitemap.ts, target: Next.js App Router
// Sitemap dinâmico: rotas fixas + produtos + categorias da API.
// A API caindo, o sitemap sai só com as rotas fixas — nunca quebra o build.
import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://airsoftamericana.com.br";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Row = { slug?: string; id?: string; updatedAt?: string };

async function fetchRows(path: string): Promise<Row[]> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    if (Array.isArray(json)) return json as Row[];
    if (json && typeof json === "object") {
      const maybe = json as { items?: unknown; data?: unknown };
      if (Array.isArray(maybe.items)) return maybe.items as Row[];
      if (Array.isArray(maybe.data)) return maybe.data as Row[];
    }
    return [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = ["", "/catalogo", "/contato", "/privacidade", "/termos"].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "daily" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }));

  const [products, categories] = await Promise.all([
    fetchRows("/api/store/products?limit=500"),
    fetchRows("/api/store/categories"),
  ]);

  return [
    ...statics,
    ...categories
      .filter((c) => c.id)
      .map((c) => ({
        url: `${SITE_URL}/catalogo?categoria=${c.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ...products
      .filter((p) => p.slug)
      .map((p) => ({
        url: `${SITE_URL}/${p.slug}`,
        lastModified: p.updatedAt ? new Date(p.updatedAt) : undefined,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
  ];
}
