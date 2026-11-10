import type { MetadataRoute } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://airsoftamericana.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/catalogo`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
  ];
  try {
    const res = await fetch(`${API_URL}/api/store/products?limit=1000&page=1`, { cache: "no-store" });
    if (!res.ok) return staticPages;
    const data = await res.json();
    const items = (data.items || []) as Array<{ slug: string; updatedAt?: string }>;
    const products: MetadataRoute.Sitemap = items.map((p) => ({
      url: `${BASE}/${p.slug}`,
      lastModified: p.updatedAt ? new Date(p.updatedAt) : now,
      changeFrequency: "weekly",
      priority: 0.7,
    }));
    return [...staticPages, ...products];
  } catch {
    return staticPages;
  }
}
