// Rotas do blog editorial — leitura pública e gestão pelo painel.
//
// Contrato:
//   GET    /api/store/blog              ?category=&q=&tag=&page=&limit=
//   GET    /api/store/blog/categories
//   GET    /api/store/blog/:slug
//   GET    /api/admin/blog              ?q=&status=
//   POST   /api/admin/blog
//   PATCH  /api/admin/blog/:id
//   DELETE /api/admin/blog/:id
//   GET    /api/admin/blog/slug-preview ?title=
import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, ilike, ne, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { blogPosts } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminGuard } from "../lib/rbac.js";

const postInputSchema = z.object({
  title: z.string().trim().min(4).max(200),
  slug: z
    .string()
    .trim()
    .min(4)
    .max(220)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug deve conter apenas letras minúsculas, números e hifens"),
  excerpt: z.string().trim().max(600).default(""),
  content: z.string().trim().min(50, "Conteúdo muito curto para publicar"),
  coverImage: z.string().trim().max(500).nullable().optional(),
  author: z.string().trim().min(2).max(120).default("Equipe Airsoft Americana"),
  category: z.string().trim().min(2).max(60).default("Guias"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  readingMinutes: z.number().int().min(1).max(120).default(4),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(320).nullable().optional(),
  published: z.boolean().default(false),
  publishedAt: z.string().datetime().optional(),
});

const postPatchSchema = postInputSchema.partial();

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function toView(row: typeof blogPosts.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt ?? "",
    content: row.content,
    coverImage: row.coverImage ?? null,
    author: row.author ?? "Equipe Airsoft Americana",
    category: row.category ?? "Guias",
    tags: (row.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    readingMinutes: row.readingMinutes,
    seoTitle: row.seoTitle ?? null,
    seoDescription: row.seoDescription ?? null,
    published: row.published,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

export function registerBlogRoutes(app: FastifyInstance, db: Db): void {
  // --------------------------------------------------------------- Publicação
  app.get("/api/store/blog", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const limit = Math.min(50, Math.max(1, Number(q.limit ?? 12) || 12));
    const search = q.q?.trim();
    const category = q.category?.trim();
    const tag = q.tag?.trim();

    const where: SQL[] = [eq(blogPosts.published, true)];
    if (category) where.push(eq(blogPosts.category, category));
    if (tag) where.push(ilike(blogPosts.tags, `%${tag}%`));
    if (search) {
      const term = `%${search}%`;
      where.push(or(ilike(blogPosts.title, term), ilike(blogPosts.excerpt, term))!);
    }
    const filter = and(...where);

    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(blogPosts)
        .where(filter)
        .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(blogPosts).where(filter),
    ]);

    const total = totals[0]?.value ?? 0;
    reply.send({
      posts: rows.map(toView),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  app.get("/api/store/blog/categories", async (request, reply) => {
    const rows = await db
      .select({ category: blogPosts.category, total: count() })
      .from(blogPosts)
      .where(eq(blogPosts.published, true))
      .groupBy(blogPosts.category)
      .orderBy(asc(blogPosts.category));
    reply.send({ categories: rows.map((r) => ({ name: r.category, total: r.total })) });
  });

  app.get("/api/store/blog/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const found = await db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.published, true), eq(blogPosts.slug, slug)))
      .limit(1);
    const post = found[0];
    if (!post) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Artigo não encontrado" } });
      return;
    }

    const related = await db
      .select()
      .from(blogPosts)
      .where(
        and(
          eq(blogPosts.published, true),
          eq(blogPosts.category, post.category ?? "Guias"),
          ne(blogPosts.id, post.id),
        ),
      )
      .orderBy(desc(blogPosts.publishedAt))
      .limit(3);

    reply.send({ post: toView(post), related: related.map(toView) });
  });

  // --------------------------------------------------------------------- Admin
  app.get("/api/admin/blog", { preHandler: [authMiddleware, adminGuard("content","read")] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const search = q.q?.trim();
    const status = q.status?.trim();

    const where: SQL[] = [];
    if (search) {
      const term = `%${search}%`;
      where.push(or(ilike(blogPosts.title, term), ilike(blogPosts.slug, term))!);
    }
    if (status === "published") where.push(eq(blogPosts.published, true));
    if (status === "draft") where.push(eq(blogPosts.published, false));
    const filter = where.length ? and(...where) : undefined;

    const rows = await db
      .select()
      .from(blogPosts)
      .where(filter)
      .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.createdAt))
      .limit(200);

    reply.send({ items: rows.map(toView) });
  });

  app.post("/api/admin/blog", { preHandler: [authMiddleware, adminGuard("content","create")] }, async (request, reply) => {
    const parsed = postInputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      reply.send({
        error: {
          code: "invalid_input",
          message: parsed.error.issues[0]?.message ?? "Dados inválidos",
          issues: parsed.error.issues,
        },
      });
      return;
    }
    const data = parsed.data;

    const duplicate = await db
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(eq(blogPosts.slug, data.slug))
      .limit(1);
    if (duplicate[0]) {
      reply.status(409);
      reply.send({ error: { code: "conflict", message: "Já existe um artigo com este slug" } });
      return;
    }

    const inserted = await db
      .insert(blogPosts)
      .values({
        title: data.title,
        slug: data.slug,
        excerpt: data.excerpt,
        content: data.content,
        coverImage: data.coverImage ?? null,
        author: data.author,
        category: data.category,
        tags: data.tags.join(","),
        readingMinutes: data.readingMinutes,
        seoTitle: data.seoTitle ?? null,
        seoDescription: data.seoDescription ?? null,
        published: data.published,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : new Date(),
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      reply.status(500);
      reply.send({ error: { code: "insert_failed", message: "Falha ao gravar artigo" } });
      return;
    }
    reply.status(201);
    reply.send({ post: toView(row) });
  });

  app.patch("/api/admin/blog/:id", { preHandler: [authMiddleware, adminGuard("content","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = postPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      reply.send({
        error: {
          code: "invalid_input",
          message: parsed.error.issues[0]?.message ?? "Dados inválidos",
          issues: parsed.error.issues,
        },
      });
      return;
    }

    const found = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
    if (!found[0]) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Artigo não encontrado" } });
      return;
    }

    const data = parsed.data;
    if (data.slug) {
      const duplicate = await db
        .select({ id: blogPosts.id })
        .from(blogPosts)
        .where(and(eq(blogPosts.slug, data.slug), ne(blogPosts.id, id)))
        .limit(1);
      if (duplicate[0]) {
        reply.status(409);
        reply.send({ error: { code: "conflict", message: "Já existe um artigo com este slug" } });
        return;
      }
    }

    const patch: Partial<typeof blogPosts.$inferInsert> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.slug !== undefined) patch.slug = data.slug;
    if (data.excerpt !== undefined) patch.excerpt = data.excerpt;
    if (data.content !== undefined) patch.content = data.content;
    if (data.coverImage !== undefined) patch.coverImage = data.coverImage ?? null;
    if (data.author !== undefined) patch.author = data.author;
    if (data.category !== undefined) patch.category = data.category;
    if (data.tags !== undefined) patch.tags = data.tags.join(",");
    if (data.readingMinutes !== undefined) patch.readingMinutes = data.readingMinutes;
    if (data.seoTitle !== undefined) patch.seoTitle = data.seoTitle ?? null;
    if (data.seoDescription !== undefined) patch.seoDescription = data.seoDescription ?? null;
    if (data.published !== undefined) patch.published = data.published;
    if (data.publishedAt !== undefined) patch.publishedAt = new Date(data.publishedAt);

    const updated = await db.update(blogPosts).set(patch).where(eq(blogPosts.id, id)).returning();
    const row = updated[0];
    if (!row) {
      reply.status(500);
      reply.send({ error: { code: "update_failed", message: "Falha ao atualizar artigo" } });
      return;
    }
    reply.send({ post: toView(row) });
  });

  app.delete("/api/admin/blog/:id", { preHandler: [authMiddleware, adminGuard("content","delete")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
    if (!found[0]) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Artigo não encontrado" } });
      return;
    }
    await db.delete(blogPosts).where(eq(blogPosts.id, id));
    reply.send({ deleted: true, id });
  });

  // Slug sugerido a partir do título — usado pelo formulário do painel.
  app.get("/api/admin/blog/slug-preview", { preHandler: [authMiddleware, adminGuard("content","read")] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const title = q.title?.trim() ?? "";
    const base = slugify(title) || "artigo";
    const found = await db
      .select({ slug: blogPosts.slug })
      .from(blogPosts)
      .where(ilike(blogPosts.slug, `${base}%`));
    const taken = new Set(found.map((f) => f.slug));
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    reply.send({ slug: candidate });
  });
}
