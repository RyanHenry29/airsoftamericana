// language: TS, file: apps/api/src/routes/blog-store.test.ts, target: vitest
// Contrato público do blog (loja) + dados da empresa usados pelo rodapé.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fastify from "fastify";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { registerStorefrontRoutes } from "./storefront.js";

let db: Awaited<ReturnType<typeof getDb>>;
let app: ReturnType<typeof fastify>;

const TAG = `blogtest${Date.now()}`;
const SLUG_PUBLICADO = `${TAG}-publicado`;
const SLUG_EQUIP = `${TAG}-equipamento`;
const SLUG_RASCUNHO = `${TAG}-rascunho`;
const postIds: string[] = [];
let insertedCompany = false;

const BODY =
  "Conteúdo de teste do artigo. ".repeat(4).trim();

beforeAll(async () => {
  db = await getDb();
  await migrate(db);

  const rows = await db
    .insert(schema.blogPosts)
    .values([
      {
        title: `${TAG} Primeiro`,
        slug: SLUG_PUBLICADO,
        excerpt: "Excerto do primeiro artigo publicado.",
        content: BODY,
        author: "Equipe Airsoft Americana",
        category: "Guias",
        tags: "airsoft, inicio",
        readingMinutes: 4,
        published: true,
      },
      {
        title: `${TAG} Segundo`,
        slug: SLUG_EQUIP,
        excerpt: "Excerto do segundo artigo publicado.",
        content: BODY,
        author: "Equipe Airsoft Americana",
        category: "Equipamento",
        tags: "colete",
        readingMinutes: 6,
        published: true,
      },
      {
        title: `${TAG} Rascunho`,
        slug: SLUG_RASCUNHO,
        excerpt: "Rascunho que não pode aparecer na loja.",
        content: BODY,
        category: "Guias",
        published: false,
      },
    ])
    .returning();
  postIds.push(...rows.map((r) => r.id));

  // Rodapé lê `empresa_dados`; cria só se o banco de teste não tiver a linha.
  const existing = await db
    .select({ key: schema.systemSettings.key })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, "empresa_dados"));
  if (existing.length === 0) {
    await db.insert(schema.systemSettings).values({
      key: "empresa_dados",
      value: {
        nome_fantasia: "Airsoft Americana",
        razao_social: "Empresa de Teste ME",
        cnpj: "00.000.000/0001-91",
        telefone_principal: "(00) 00000-0000",
        email_contato: "teste@example.com",
      },
    });
    insertedCompany = true;
  }

  app = fastify();
  registerStorefrontRoutes(app, db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  try {
    if (postIds.length) await db.delete(schema.blogPosts).where(inArray(schema.blogPosts.id, postIds));
    if (insertedCompany) {
      await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, "empresa_dados"));
    }
  } catch {
    /* melhor esforço */
  }
});

describe("GET /api/store/blog", () => {
  it("lista apenas artigos publicados, com paginação", async () => {
    const res = await app.inject({ method: "GET", url: `/api/store/blog?limit=50` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      posts: Array<{ slug: string; published: boolean; content: string }>;
      total: number;
      page: number;
      totalPages: number;
    };
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.totalPages).toBeGreaterThanOrEqual(1);
    expect(body.posts.some((p) => p.slug === SLUG_PUBLICADO)).toBe(true);
    expect(body.posts.some((p) => p.slug === SLUG_RASCUNHO)).toBe(false);
    for (const p of body.posts) expect(p.published).toBe(true);
  });

  it("filtra por categoria", async () => {
    const res = await app.inject({ method: "GET", url: `/api/store/blog?category=Equipamento&limit=50` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { posts: Array<{ slug: string; category: string }> };
    expect(body.posts.some((p) => p.slug === SLUG_EQUIP)).toBe(true);
    expect(body.posts.some((p) => p.slug === SLUG_PUBLICADO)).toBe(false);
    for (const p of body.posts) expect(p.category).toBe("Equipamento");
  });

  it("filtra por busca", async () => {
    const res = await app.inject({ method: "GET", url: `/api/store/blog?q=${TAG}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { posts: Array<{ slug: string }> };
    expect(body.posts.some((p) => p.slug === SLUG_PUBLICADO)).toBe(true);
    expect(body.posts.some((p) => p.slug === SLUG_RASCUNHO)).toBe(false);
  });
});

describe("GET /api/store/blog/categories", () => {
  it("conta somente publicados, agrupados por categoria", async () => {
    const res = await app.inject({ method: "GET", url: "/api/store/blog/categories" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { categories: Array<{ name: string; total: number }> };
    const guias = body.categories.find((c) => c.name === "Guias");
    const equip = body.categories.find((c) => c.name === "Equipamento");
    expect(guias?.total).toBeGreaterThanOrEqual(1);
    expect(equip?.total).toBeGreaterThanOrEqual(1);
    for (const c of body.categories) expect(c.total).toBeGreaterThan(0);
  });
});

describe("GET /api/store/blog/:slug", () => {
  it("devolve o artigo e relacionados da mesma categoria", async () => {
    const res = await app.inject({ method: "GET", url: `/api/store/blog/${SLUG_PUBLICADO}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      post: { slug: string; title: string; content: string; readingMinutes: number; tags: string[] };
      related: Array<{ slug: string; category: string }>;
    };
    expect(body.post.slug).toBe(SLUG_PUBLICADO);
    expect(body.post.title).toContain(TAG);
    expect(body.post.content.length).toBeGreaterThan(10);
    expect(typeof body.post.readingMinutes).toBe("number");
    expect(Array.isArray(body.post.tags)).toBe(true);
    expect(Array.isArray(body.related)).toBe(true);
    expect(body.related.every((r) => r.slug !== SLUG_PUBLICADO)).toBe(true);
  });

  it("artigo não publicado responde 404", async () => {
    const res = await app.inject({ method: "GET", url: `/api/store/blog/${SLUG_RASCUNHO}` });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});

describe("GET /api/store/company", () => {
  it("devolve CNPJ para o rodapé (ou company null sem cadastro)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/store/company" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      company: { nome_fantasia: string; razao_social: string; cnpj: string } | null;
    };
    expect(body).toHaveProperty("company");
    if (body.company) {
      expect(body.company.cnpj.length).toBeGreaterThan(8);
      expect(body.company.nome_fantasia.length).toBeGreaterThan(0);
    }
  });
});
