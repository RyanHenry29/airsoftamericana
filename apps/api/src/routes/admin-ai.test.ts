// language: TS, file: apps/api/src/routes/admin-ai.test.ts, target: vitest
// HTTP + integração (app.inject, migrações reais, PGlite isolado por worker)
// Cobre: RBAC 401/403, CSRF, 503 rotulado sem GROQ_API_KEY, contrato do rascunho
// (zod + reparo de id inválido), magic bytes de imagem, roundtrip upload→serve, rate limit.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { createSession } from "../services/sessions.js";
import { csrfGuard, csrfTokenForSession } from "../lib/csrf.js";
import { authMiddleware } from "../middleware/auth.js";
import { registerAdminAiRoutes } from "./admin-ai.js";

let db: any;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const testConfig = {
  API_PORT: 4321, API_HOST: "127.0.0.1", NODE_ENV: "test", DATABASE_URL: "", JWT_SECRET: "test-secret-do-not-use-in-production",
  GATEWAY_SECRETS_KEY: "", STORE_URL: "http://localhost:3000", ADMIN_URL: "http://localhost:3001", STORE_NAME: "Airsoft Americana",
  STORE_WHATSAPP: "", GATEWAY_ACTIVE: "sandbox", LOG_LEVEL: "silent", MERCADOPAGO_ACCESS_TOKEN: "", PAGBANK_API_KEY: "",
  CIELO_CLIENT_ID: "", CIELO_CLIENT_SECRET: "", AUTH_LOGIN_MAX: 5, AUTH_LOGIN_WINDOW_MS: 60_000, AUTH_LOGIN_BLOCK_MS: 15 * 60_000,
  AUTH_REGISTER_MAX: 3, AUTH_REGISTER_WINDOW_MS: 60 * 60_000, AUTH_REGISTER_BLOCK_MS: 24 * 60 * 60_000, AUTH_ADMIN_MAX: 10,
  AUTH_ADMIN_WINDOW_MS: 60_000, AUTH_ADMIN_BLOCK_MS: 15 * 60_000, RATE_LIMIT_MAX: 600, RATE_LIMIT_WINDOW_MS: 60_000,
  CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_AUD: "",
  GROQ_API_KEY: "", GROQ_MODEL: "qwen/qwen3.8-27b",
} as any;

async function makeAuthed(role: string) {
  const email = `ai-${role}-${RUN}-${Math.random().toString(36).slice(2)}@t.local`;
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword("Senha123!"), name: role, role, active: true, mfaEnabled: true })
    .returning();
  const s = await createSession(db, { userId: u.id, mfaVerified: true });
  return { userId: u.id, token: s.token, csrf: csrfTokenForSession(s.id) };
}

async function buildApp(cfg: any = testConfig) {
  const app = fastify({ bodyLimit: 4 * 1024 * 1024 });
  await app.register(cookie);
  app.decorate("db", db);
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin")) await authMiddleware(req as any);
  });
  app.addHook("preHandler", csrfGuard);
  registerAdminAiRoutes(app, db, cfg);
  await app.ready();
  return app;
}

/** PNG 1×1 real (magic bytes válidos). */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_B64 = PNG_1PX.toString("base64");

/** Resposta canônica do Groq (JSON Object Mode). */
function groqJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  };
}

/** Formato de erro nativo do Fastify: {statusCode, code, message} (helpers em errors.ts). */
function errCode(res: { json: () => any }): { code?: string; message?: string } {
  const body = res.json();
  return { code: body?.code ?? body?.error?.code, message: body?.message ?? body?.error?.message };
}

let fetchMock: ReturnType<typeof vi.fn>;

let catId = "";
let brandId = "";

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  await db
    .insert(schema.categories)
    .values({ name: `[DEMO] ai-cat-${RUN}`, slug: `ai-cat-${RUN}`, description: "", ageRestricted: false, active: true, position: 0 } as any)
    .onConflictDoNothing({ target: schema.categories.slug } as any);
  const [c] = await db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.slug, `ai-cat-${RUN}`)).limit(1);
  catId = c.id;
  await db
    .insert(schema.brands)
    .values({ name: `[DEMO] ai-brand-${RUN}`, slug: `ai-brand-${RUN}`, active: true, position: 0 } as any)
    .onConflictDoNothing({ target: schema.brands.slug } as any);
  const [b] = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.slug, `ai-brand-${RUN}`)).limit(1);
  brandId = b.id;
});

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  try {
    await db?.delete(schema.aiConversations);
  } catch {
    // suíte compartilha PGlite — falha na limpeza não mascara resultado
  }
});

describe("Guard e contrato básico", () => {
  it("401 sem sessão", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/admin/ai/messages", payload: { content: "oi" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("403 para papel sem permissão de criação (atendimento: products read-only)", async () => {
    const app = await buildApp();
    const a = await makeAuthed("atendimento");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "crie um produto" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("403 sem token CSRF em mutação (guard global + guard por rota)", async () => {
    const app = await buildApp();
    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token },
      payload: { content: "sem csrf" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("503 rotulado quando GROQ_API_KEY não está configurada", async () => {
    const app = await buildApp();
    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "descreva a foto" },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.code).toBe("ai_not_configured");
    expect(body.message).toContain("GROQ_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("Rascunho anti-alucinação", () => {
  it("categoryId inválida vira null + flag; preço/estoque sempre null; slug/SKU do servidor", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockResolvedValue(
      groqJson({
        reply: "Rascunho pronto para revisão.",
        draft: {
          name: `Réplica M4 CQB ${RUN}`,
          description: "Réplica full metal com internal gearbox.",
          shortDescription: "M4 CQB full metal",
          color: "Preto",
          technical: { Material: "Metal", "Alcance": "35 m" },
          categoryId: "00000000-0000-0000-0000-0000000000ff", // não existe no DB
          brandId,
          condicao: "novo",
          estadoConservacao: "",
          tags: "m4, cqb",
          seoTitle: "Réplica M4 CQB",
          seoDescription: "M4 CQB full metal",
          variantName: "Padrão",
          weightGrams: 3200,
          uncertainFields: ["Alcance real"],
          // sem preço/estoque de propósito — fora do schema do modelo
        },
      }),
    );

    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "foto da réplica m4" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conversationId).toBeTruthy();
    expect(body.draft).toBeTruthy();

    const payload = body.draft.payload;
    expect(payload.categoryId).toBeNull();
    expect(payload.brandId).toBe(brandId);
    expect(payload.priceCents).toBeNull();
    expect(payload.promoPriceCents).toBeNull();
    expect(payload.stockPhysical).toBeNull();
    expect(payload.slug).toMatch(/^[a-z0-9-]+$/);
    expect(payload.sku.length).toBeGreaterThan(0);

    const flags: string[] = body.draft.flags;
    expect(flags.some((f) => f.includes("categoryId"))).toBe(true);
    expect(flags.some((f) => f.includes("incerto"))).toBe(true);

    // grounding enviado ao Groq contém ids reais do banco (nada inventado)
    const sent = fetchMock.mock.calls[0]![1]! as { body: string };
    const reqBody = JSON.parse(sent.body);
    const systemText = reqBody.messages[0].content;
    expect(systemText).toContain(catId);
    expect(systemText).toContain(brandId);
    expect(reqBody.response_format).toEqual({ type: "json_object" });
    expect(reqBody.temperature).toBeLessThanOrEqual(0.3);

    // rascunho persistido como pendente
    const [draftRow] = await db
      .select()
      .from(schema.aiDrafts)
      .where(eq(schema.aiDrafts.conversationId, body.conversationId))
      .limit(1);
    expect(draftRow.status).toBe("pendente");

    await app.close();
  });

  it("slug duplicado ganha sufixo — nunca sobrescreve produto existente", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    // produto já existe com o slug base derivado do nome
    const base = `produto-dup-${RUN}`;
    await db
      .insert(schema.products)
      .values({ name: `[DEMO] ${base}`, slug: base, shortDescription: "d", description: "d", categoryId: catId, ageRestricted: false, featured: false, published: true, condicao: "novo" } as any)
      .returning();
    fetchMock.mockResolvedValue(
      groqJson({
        reply: "Ajustado.",
        draft: {
          name: base, // slugify → mesmo slug base
          description: "d", shortDescription: "d", color: "", technical: {},
          categoryId: catId, brandId: "", condicao: "novo", estadoConservacao: "",
          tags: "", seoTitle: "", seoDescription: "", variantName: "Padrão",
          weightGrams: 0, uncertainFields: [],
        },
      }),
    );
    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "outro igual" },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json().draft.payload;
    expect(payload.slug).not.toBe(base);
    expect(payload.slug.startsWith(base)).toBe(true);
    await app.close();
  });

  it("resposta do Groq fora do contrato vira 503 rotulado (nunca draft malformado)", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockResolvedValue(
      groqJson({ reply: 12345, draft: { name: "" } }), // campos errados
    );
    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "x" },
    });
    expect(res.statusCode).toBe(503);
    expect(errCode(res).code).toBe("ai_bad_response");
    await app.close();
  });

  it("falha de rede com o Groq vira 503 rotulado (ai_unreachable)", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "x" },
    });
    expect(res.statusCode).toBe(503);
    expect(errCode(res).code).toBe("ai_unreachable");
    await app.close();
  });
});

describe("Imagens: magic bytes e roundtrip", () => {
  it("rejeita conteúdo que não é JPEG/PNG/WebP (nome de arquivo não engana)", async () => {
    const app = await buildApp();
    const a = await makeAuthed("superadmin");
    const before = (await db.select({ id: schema.aiUploads.id }).from(schema.aiUploads)).length;
    const fake = Buffer.from("MZ\x90\x00 exe não é imagem").toString("base64");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "veja", images: [fake] },
    });
    expect(res.statusCode).toBe(400);
    expect(errCode(res).code).toBe("ai_image_type");
    const after = (await db.select({ id: schema.aiUploads.id }).from(schema.aiUploads)).length;
    expect(after).toBe(before); // nenhuma escrita antes da validação
    await app.close();
  });

  it("rejeita imagem acima do limite", async () => {
    const app = await buildApp();
    const a = await makeAuthed("superadmin");
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(900 * 1024, 7)]).toString("base64");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "grande", images: [big] },
    });
    expect(res.statusCode).toBe(400);
    expect(errCode(res).code).toBe("ai_image_too_large");
    await app.close();
  });

  it("roundtrip: upload aceito → bytes servidos na GET com mime correto", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockResolvedValue(groqJson({ reply: "Recebido.", draft: null }));
    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "foto do produto", images: [PNG_B64] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const uploadId = body.userMessage.uploadIds[0];
    expect(uploadId).toBeTruthy();

    const get = await app.inject({
      method: "GET", url: `/api/admin/ai/uploads/${uploadId}`,
      cookies: { aa_session: a.token },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(get.rawPayload).equals(PNG_1PX)).toBe(true);

    // a imagem viaja ao Groq como data URL
    const reqBody = JSON.parse((fetchMock.mock.calls[0]![1]! as { body: string }).body);
    const lastMsg = reqBody.messages[reqBody.messages.length - 1];
    expect(Array.isArray(lastMsg.content)).toBe(true);
    expect(JSON.stringify(lastMsg.content)).toContain("data:image/png;base64,");
    await app.close();
  });

  it("imagem de outro admin não é servida (posse do upload)", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockResolvedValue(groqJson({ reply: "ok", draft: null }));
    const owner = await makeAuthed("superadmin");
    const intruder = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: owner.token }, headers: { "x-csrf-token": owner.csrf },
      payload: { content: "minha foto", images: [PNG_B64] },
    });
    const uploadId = res.json().userMessage.uploadIds[0];
    const get = await app.inject({
      method: "GET", url: `/api/admin/ai/uploads/${uploadId}`,
      cookies: { aa_session: intruder.token },
    });
    expect(get.statusCode).toBe(404);
    await app.close();
  });
});

describe("Rascunho: transição de status", () => {
  it("publicado exige productId existente; descartado funciona; publicado é estado final", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockResolvedValue(
      groqJson({
        reply: "ok",
        draft: {
          name: `Transição ${RUN}`, description: "d", shortDescription: "d", color: "", technical: {},
          categoryId: catId, brandId: "", condicao: "novo", estadoConservacao: "",
          tags: "", seoTitle: "", seoDescription: "", variantName: "Padrão",
          weightGrams: 0, uncertainFields: [],
        },
      }),
    );
    const a = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { content: "cria" },
    });
    const draftId = res.json().draft.id;

    // publicar sem productId → 400
    const noProduct = await app.inject({
      method: "PATCH", url: `/api/admin/ai/drafts/${draftId}`,
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { status: "publicado" },
    });
    expect(noProduct.statusCode).toBe(400);

    // descartar → ok
    const discard = await app.inject({
      method: "PATCH", url: `/api/admin/ai/drafts/${draftId}`,
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { status: "descartado" },
    });
    expect(discard.statusCode).toBe(200);

    // publicar com productId inexistente → 404
    const badProduct = await app.inject({
      method: "PATCH", url: `/api/admin/ai/drafts/${draftId}`,
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { status: "publicado", productId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(badProduct.statusCode).toBe(404);

    // publicar com produto real → ok, e depois fica travado
    const [p] = await db
      .insert(schema.products)
      .values({ name: `[DEMO] pub-${RUN}`, slug: `pub-${RUN}`, shortDescription: "d", description: "d", categoryId: catId, ageRestricted: false, featured: false, published: true, condicao: "novo" } as any)
      .returning();
    const pub = await app.inject({
      method: "PATCH", url: `/api/admin/ai/drafts/${draftId}`,
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { status: "publicado", productId: p.id },
    });
    expect(pub.statusCode).toBe(200);

    const locked = await app.inject({
      method: "PATCH", url: `/api/admin/ai/drafts/${draftId}`,
      cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
      payload: { status: "descartado" },
    });
    expect(locked.statusCode).toBe(400);
    expect(errCode(locked).code).toBe("ai_draft_locked");

    const [row] = await db.select().from(schema.aiDrafts).where(eq(schema.aiDrafts.id, draftId)).limit(1);
    expect(row.status).toBe("publicado");
    expect(row.productId).toBe(p.id);
    await app.close();
  });

  it("rascunho de outro admin não aparece (posse)", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockResolvedValue(
      groqJson({
        reply: "ok",
        draft: {
          name: `Privado ${RUN}`, description: "d", shortDescription: "", color: "", technical: {},
          categoryId: catId, brandId: "", condicao: "novo", estadoConservacao: "",
          tags: "", seoTitle: "", seoDescription: "", variantName: "Padrão",
          weightGrams: 0, uncertainFields: [],
        },
      }),
    );
    const owner = await makeAuthed("superadmin");
    const intruder = await makeAuthed("superadmin");
    const res = await app.inject({
      method: "POST", url: "/api/admin/ai/messages",
      cookies: { aa_session: owner.token }, headers: { "x-csrf-token": owner.csrf },
      payload: { content: "privado" },
    });
    const { conversationId, draft } = res.json();

    const peek = await app.inject({
      method: "GET", url: `/api/admin/ai/conversations/${conversationId}`,
      cookies: { aa_session: intruder.token },
    });
    expect(peek.statusCode).toBe(404);

    const patch = await app.inject({
      method: "PATCH", url: `/api/admin/ai/drafts/${draft.id}`,
      cookies: { aa_session: intruder.token }, headers: { "x-csrf-token": intruder.csrf },
      payload: { status: "descartado" },
    });
    expect(patch.statusCode).toBe(404);
    await app.close();
  });
});

describe("Rate limit do assistente", () => {
  it("13ª mensagem no minuto → 429", async () => {
    const cfg = { ...testConfig, GROQ_API_KEY: "gsk_test" };
    const app = await buildApp(cfg);
    fetchMock.mockResolvedValue(groqJson({ reply: "ok", draft: null }));
    const a = await makeAuthed("superadmin");
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await app.inject({
        method: "POST", url: "/api/admin/ai/messages",
        cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf },
        payload: { content: `msg ${i}` },
      });
      codes.push(res.statusCode);
      if (res.statusCode === 429) break;
    }
    expect(codes).toContain(429);
    expect(codes[0]).toBe(200); // as primeiras passam
    await app.close();
  });
});
