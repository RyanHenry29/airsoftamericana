// language: TS, file: apps/store/src/app/lib/blog.ts, target: Next.js App Router
// Contrato de leitura do blog editorial (GET /api/store/blog*).
import { API_URL, storeGet } from "./store";

export type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string | null;
  author: string;
  category: string;
  tags: string[];
  readingMinutes: number;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
};

export type BlogList = {
  posts: BlogPost[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type BlogDetail = { post: BlogPost; related: BlogPost[] };

export const EMPTY_BLOG_LIST: BlogList = {
  posts: [],
  total: 0,
  page: 1,
  limit: 12,
  totalPages: 1,
};

export async function fetchBlogList(opts: {
  page?: number;
  limit?: number;
  category?: string;
  q?: string;
} = {}): Promise<BlogList> {
  const qs = new URLSearchParams();
  if (opts.page && opts.page > 1) qs.set("page", String(opts.page));
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.category) qs.set("category", opts.category);
  if (opts.q) qs.set("q", opts.q);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return storeGet<BlogList>(`${API_URL}/api/store/blog${suffix}`, EMPTY_BLOG_LIST);
}

export async function fetchBlogPost(slug: string): Promise<BlogDetail | null> {
  return storeGet<BlogDetail | null>(
    `${API_URL}/api/store/blog/${encodeURIComponent(slug)}`,
    null,
  );
}

export async function fetchBlogCategories(): Promise<{ name: string; total: number }[]> {
  const res = await storeGet<{ categories: { name: string; total: number }[] }>(
    `${API_URL}/api/store/blog/categories`,
    { categories: [] },
  );
  return res.categories ?? [];
}

/** Data publicada em pt-BR — entrada vazia vira string vazia, nunca "Invalid Date". */
export function formatPostDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** Conteúdo em parágrafos: quebra em linhas em branco, sem HTML cru. */
export function paragraphs(content: string): string[] {
  return content
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
