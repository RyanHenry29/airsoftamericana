// language: TS, file: apps/api/src/rbac-http-manual.test.ts, target: vitest
// ~15 asserções HTTP manuais, INDEPENDENTES da matriz can() — expectativas hardcoded.
// Complementa rbac-http.test.ts (que gera 560 casos a partir da própria matriz).
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { getDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { schema } from "./db/index.js";
import { hashPassword } from "./lib/crypto.js";
import { createSession } from "./services/sessions.js";
import { authMiddleware } from "./middleware/auth.js";
import { csrfGuard, csrfTokenForSession } from "./lib/csrf.js";
import { adminGuard } from "./lib/rbac.js";
import { registerAdminRoutes } from "./routes/admin.js";

let db: any;

async function makeAuthed(role: string) {
  const email = `rbac-man-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@t.local`;
  const [u] = await db
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword("Senha123!"), name: role, role, active: true, mfaEnabled: true })
    .returning();
  const s = await createSession(db, { userId: u.id, mfaVerified: true });
  return { userId: u.id, token: s.token, sessionId: s.id, csrf: csrfTokenForSession(s.id) };
}

async function buildFullApp() {
  const app = fastify();
  await app.register(cookie);
  app.decorate("db", db);
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin")) await authMiddleware(req as any);
  });
  app.addHook("preHandler", csrfGuard);
  registerAdminRoutes(app, db);
  // rotas sintéticas: módulos sem endpoint dedicado ou para asserção isolada de guard
  app.get("/api/admin/_t/payments", { preHandler: [authMiddleware, adminGuard("payments" as any, "read")] }, async () => ({ ok: true }));
  app.patch("/api/admin/_t/payments/:id", { preHandler: [authMiddleware, adminGuard("payments" as any, "update")] }, async () => ({ ok: true }));
  app.post("/api/admin/_t/payments/:id/refund", { preHandler: [authMiddleware, adminGuard("payments" as any, "update")] }, async () => ({ ok: true }));
  app.get("/api/admin/_t/orders", { preHandler: [authMiddleware, adminGuard("orders" as any, "read")] }, async () => ({ ok: true }));
  app.patch("/api/admin/_t/orders/:id/transition", { preHandler: [authMiddleware, adminGuard("orders" as any, "update")] }, async () => ({ ok: true }));
  app.post("/api/admin/_t/inventory/movements", { preHandler: [authMiddleware, adminGuard("inventory" as any, "update")] }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

describe("RBAC HTTP manual — independente da matriz", () => {
  // 1-3: estoque não lê nem altera pagamentos nem reembolsa
  it("estoque NÃO lê pagamentos (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("estoque");
    const res = await app.inject({ method: "GET", url: "/api/admin/_t/payments", cookies: { aa_session: a.token } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("estoque NÃO altera pagamentos (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("estoque");
    const res = await app.inject({ method: "PATCH", url: "/api/admin/_t/payments/x", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("estoque NÃO reembolsa (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("estoque");
    const res = await app.inject({ method: "POST", url: "/api/admin/_t/payments/x/refund", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // 4-5: atendimento não altera preço nem usuários
  it("atendimento NÃO altera preço/variante (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("atendimento");
    const res = await app.inject({ method: "PATCH", url: "/api/admin/variants/00000000-0000-0000-0000-000000000000", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { priceCents: 1 } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("atendimento NÃO altera usuários (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("atendimento");
    const res = await app.inject({ method: "PATCH", url: "/api/admin/users/00000000-0000-0000-0000-000000000000", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { role: "gerente" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // 6-7: marketing não toca pedidos
  it("marketing NÃO lê pedidos (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("marketing");
    const res = await app.inject({ method: "GET", url: "/api/admin/_t/orders", cookies: { aa_session: a.token } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("marketing NÃO altera pedidos (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("marketing");
    const res = await app.inject({ method: "PATCH", url: "/api/admin/_t/orders/x/transition", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { status: "separacao" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // 8-9: financeiro não edita catálogo
  it("financeiro NÃO edita produto/catálogo (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("financeiro");
    const res = await app.inject({ method: "PATCH", url: "/api/admin/categories/00000000-0000-0000-0000-000000000000", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { name: "x" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("financeiro NÃO importa catálogo (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("financeiro");
    const res = await app.inject({ method: "POST", url: "/api/admin/catalog/import", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { file: "a;b;c;1;cat" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // 10-12: somente-leitura não escreve em nenhum módulo (amostra representativa)
  it("somente-leitura NÃO cria categoria (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("somente-leitura");
    const res = await app.inject({ method: "POST", url: "/api/admin/categories", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { name: "X", slug: "x-ro" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("somente-leitura NÃO movimenta estoque (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("somente-leitura");
    const res = await app.inject({ method: "POST", url: "/api/admin/_t/inventory/movements", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { variantId: "x", type: "entrada", quantity: 1, reason: "t" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("somente-leitura NÃO altera settings (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("somente-leitura");
    const res = await app.inject({ method: "PUT", url: "/api/admin/settings/k", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { value: 1 } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // 13-15: só superadmin gerencia usuários, convites e sessões de terceiros
  it("gerente NÃO cria convite — só superadmin (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("gerente");
    const res = await app.inject({ method: "POST", url: "/api/admin/invites", cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { email: "novo@t.local", role: "atendimento" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("gerente NÃO altera papel de usuário — só superadmin (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("gerente");
    const target = await makeAuthed("atendimento");
    const res = await app.inject({ method: "PATCH", url: `/api/admin/users/${target.userId}`, cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf }, payload: { role: "estoque" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it("gerente NÃO revoga sessão de terceiro — só superadmin (403)", async () => {
    const app = await buildFullApp();
    const a = await makeAuthed("gerente");
    const other = await makeAuthed("atendimento");
    const res = await app.inject({ method: "DELETE", url: `/api/admin/sessions/${other.sessionId}`, cookies: { aa_session: a.token }, headers: { "x-csrf-token": a.csrf } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
