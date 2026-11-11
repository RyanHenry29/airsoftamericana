// language: TS, file: apps/api/src/routes/homepage-sections.test.ts, target: vitest
// CRUD administrativo das seções da home (GET/POST/PATCH/reorder/DELETE) e a
// leitura pública em /api/store/home: RBAC 401/403 por papel, ordem por
// position e filtro de inativas. kind carrega o RUN para isolar dos dados
// persistidos entre execuções do PGlite de teste.
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { eq } from "drizzle-orm";
import { routes } from "./index.js";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { schema } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { hashPassword } from "../lib/crypto.js";
import { createSession, ADMIN_SESSION_COOKIE } from "../services/sessions.js";

let db: any;
let app: any;

/** Marcador único por execução — o banco de teste persiste entre rodadas. */
const RUN = Date.now().toString(36);
const KIND = `sec-${RUN}`; // varchar(40): 4 + ~10 caracteres

async function makeUser(role: string) {
  const email = `hp-${role}-${RUN}-${Math.random().toString(36).slice(2, 6)}@t.local`;
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword("Senha123!"), name: role, role, active: true, mfaEnabled: true })
    .returning();
  const s = await createSession(db, { userId: u.id, mfaVerified: true });
  return { token: s.token };
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  const instance = fastify();
  await instance.register(fastifyCookie);
  instance.decorate("db", db); // authMiddleware/dbOf lê da instância
  await routes(instance, config as any, db);
  await instance.ready();
  app = instance;
});

describe("RBAC de /api/admin/homepage-sections", () => {
  it("sem sessão responde 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/homepage-sections" });
    expect(res.statusCode).toBe(401);
  });

  it("papel sem homepage (estoque) responde 403 mesmo com sessão válida", async () => {
    const estoque = await makeUser("estoque");
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/homepage-sections",
      cookies: { [ADMIN_SESSION_COOKIE]: estoque.token },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("CRUD administrativo", () => {
  let firstId = "";
  let secondId = "";

  it("POST sem kind responde 400 rotulado", async () => {
    const admin = await makeUser("superadmin");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/homepage-sections",
      cookies: { [ADMIN_SESSION_COOKIE]: admin.token },
      payload: { title: "sem tipo" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_input");
  });

  it("POST cria a seção com defaults (position 0, active true, config {}) e audita", async () => {
    const admin = await makeUser("superadmin");
    const cookie = { [ADMIN_SESSION_COOKIE]: admin.token };

    const a = await app.inject({
      method: "POST",
      url: "/api/admin/homepage-sections",
      cookies: cookie,
      payload: { kind: KIND, title: "Vitrine A", position: 7, config: { source: "teste" } },
    });
    expect(a.statusCode).toBe(201);
    const sectionA = a.json().section;
    expect(sectionA.id).toBeTruthy();
    expect(sectionA.position).toBe(7);
    expect(sectionA.active).toBe(true);
    expect(sectionA.config).toEqual({ source: "teste" });
    firstId = sectionA.id;

    const b = await app.inject({
      method: "POST",
      url: "/api/admin/homepage-sections",
      cookies: cookie,
      payload: { kind: KIND, title: "Vitrine B", position: 2, active: false },
    });
    expect(b.statusCode).toBe(201);
    secondId = b.json().section.id;
    expect(b.json().section.active).toBe(false);

    // auditoria gravada com a ação certa (pelo menos as duas do teste)
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, "homepage_section.created"))
      .limit(50);
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("GET lista na ordem das posições (asc)", async () => {
    const admin = await makeUser("superadmin");
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/homepage-sections",
      cookies: { [ADMIN_SESSION_COOKIE]: admin.token },
    });
    expect(res.statusCode).toBe(200);
    const mine = res.json().items.filter((s: any) => s.kind === KIND);
    expect(mine.map((s: any) => s.id)).toEqual([secondId, firstId]); // 2 antes de 7
  });

  it("PATCH atualiza campos enviados; id inexistente responde 404", async () => {
    const admin = await makeUser("superadmin");
    const cookie = { [ADMIN_SESSION_COOKIE]: admin.token };

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/admin/homepage-sections/${secondId}`,
      cookies: cookie,
      payload: { title: "Vitrine B editada", active: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().section.title).toBe("Vitrine B editada");
    expect(ok.json().section.active).toBe(true);
    // position não foi enviado — continua 2
    expect(ok.json().section.position).toBe(2);

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/admin/homepage-sections/00000000-0000-4000-8000-000000000000",
      cookies: cookie,
      payload: { title: "nada" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });

  it("reorder grava position sequencial na ordem dos ids recebidos", async () => {
    const admin = await makeUser("superadmin");
    const cookie = { [ADMIN_SESSION_COOKIE]: admin.token };

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/homepage-sections/reorder",
      cookies: cookie,
      payload: { ids: [firstId, secondId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, count: 2 });

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/homepage-sections",
      cookies: cookie,
    });
    const mine = list.json().items.filter((s: any) => s.kind === KIND);
    expect(mine.map((s: any) => s.id)).toEqual([firstId, secondId]);
    expect(mine.map((s: any) => s.position)).toEqual([0, 1]);
  });

  it("somente-leitura lê (200) mas não cria (403)", async () => {
    const leitor = await makeUser("somente-leitura");
    const cookie = { [ADMIN_SESSION_COOKIE]: leitor.token };

    const read = await app.inject({
      method: "GET",
      url: "/api/admin/homepage-sections",
      cookies: cookie,
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/api/admin/homepage-sections",
      cookies: cookie,
      payload: { kind: KIND, title: "bloqueada" },
    });
    expect(write.statusCode).toBe(403);
  });

  it("DELETE remove e some da listagem", async () => {
    const admin = await makeUser("superadmin");
    const cookie = { [ADMIN_SESSION_COOKIE]: admin.token };

    const del = await app.inject({
      method: "DELETE",
      url: `/api/admin/homepage-sections/${firstId}`,
      cookies: cookie,
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/admin/homepage-sections", cookies: cookie });
    const mine = list.json().items.filter((s: any) => s.kind === KIND);
    expect(mine.map((s: any) => s.id)).not.toContain(firstId);
    expect(mine.map((s: any) => s.id)).toContain(secondId);
  });
});

describe("GET /api/store/home (vitrine)", () => {
  it("devolve só seções ativas na ordem das posições", async () => {
    // Inserção direta: isola o caso (ativa 90, inativa 91, ativa 92) sem
    // depender do CRUD testado acima.
    const [a90] = await db
      .insert(schema.homepageSections)
      .values({ kind: KIND, title: "loja ativa 90", position: 90, active: true })
      .returning();
    const [b91] = await db
      .insert(schema.homepageSections)
      .values({ kind: KIND, title: "loja inativa 91", position: 91, active: false })
      .returning();
    const [c92] = await db
      .insert(schema.homepageSections)
      .values({ kind: KIND, title: "loja ativa 92", position: 92, active: true })
      .returning();

    const res = await app.inject({ method: "GET", url: "/api/store/home" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const mine = body.sections.filter((s: any) => s.kind === KIND && s.position >= 90);
    expect(mine.map((s: any) => s.id)).toEqual([a90.id, c92.id]); // ordem 90 < 92
    expect(mine.map((s: any) => s.id)).not.toContain(b91.id); // inativa fora
    expect(mine[0].config).toEqual({}); // config serializa como objeto
  });
});
