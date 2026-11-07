// language: TS, file: apps/api/src/rbac-http.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { eq } from "drizzle-orm";
import { getDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { schema } from "./db/index.js";
import { hashPassword } from "./lib/crypto.js";
import { createSession } from "./services/sessions.js";
import { authMiddleware } from "./middleware/auth.js";
import { adminGuard, ROLES, can, type Role } from "./lib/rbac.js";
import { csrfGuard, csrfTokenForSession } from "./lib/csrf.js";

const MODULES = [
  "dashboard","products","categories","brands","inventory","orders","payments","chargebacks",
  "fraud","promotions","coupons","banners","homepage","menu","shipping","customers","content","reports","users","audit","settings",
] as const;
const ACTIONS = ["read","create","update","delete"] as const;

let db: any;
const sessionsByRole = new Map<Role, { token: string; sessionId: string }>();

async function makeUser(role: Role): Promise<string> {
  const email = `rbac-http-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@t.local`;
  const [u] = await db.insert(schema.users).values({
    email, passwordHash: await hashPassword("Senha123!"), name: role, role, active: true, mfaEnabled: true,
  }).returning();
  return u.id;
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  for (const role of ROLES) {
    const uid = await makeUser(role);
    const s = await createSession(db, { userId: uid, mfaVerified: true });
    sessionsByRole.set(role, { token: s.token, sessionId: s.id });
  }
});

describe("B.9 — RBAC HTTP (app.inject) gerado da matriz papel×módulo×ação", () => {
  it("cada papel × módulo × ação: permitido/negado conforme can()", async () => {
    const app = fastify();
    await app.register(cookie);
    app.decorate("db", db);
    // monta uma rota guardada por (módulo, ação) para cada combinação
    for (const mod of MODULES) {
      for (const act of ACTIONS) {
        app.get(`/api/admin/t/${mod}/${act}`, { preHandler: [authMiddleware, adminGuard(mod as any, act)] }, async () => ({ ok: true }));
      }
    }
    await app.ready();

    const failures: string[] = [];
    for (const role of ROLES) {
      const sess = sessionsByRole.get(role)!;
      for (const mod of MODULES) {
        for (const act of ACTIONS) {
          const expected = can(role, mod as any, act);
          const res = await app.inject({
            method: "GET",
            url: `/api/admin/t/${mod}/${act}`,
            cookies: { aa_session: sess.token },
          });
          const allowed = res.statusCode === 200;
          if (allowed !== expected) {
            failures.push(`${role} ${mod}:${act} expected=${expected ? "allow" : "deny"} got=${res.statusCode}`);
          }
        }
      }
    }
    await app.close();
    expect(failures).toEqual([]);
  });
});

describe("B.9 — sessão expirada e revogada (HTTP)", () => {
  it("sessão expirada (absoluta) → 401", async () => {
    const uid = await makeUser("gerente");
    const s = await createSession(db, { userId: uid, mfaVerified: true });
    await db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, s.id));
    const app = fastify();
    await app.register(cookie);
    app.decorate("db", db);
    app.get("/api/admin/ping", { preHandler: [authMiddleware] }, async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/api/admin/ping", cookies: { aa_session: s.token } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("sessão revogada → 401", async () => {
    const uid = await makeUser("gerente");
    const s = await createSession(db, { userId: uid, mfaVerified: true });
    await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, s.id));
    const app = fastify();
    await app.register(cookie);
    app.decorate("db", db);
    app.get("/api/admin/ping", { preHandler: [authMiddleware] }, async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/api/admin/ping", cookies: { aa_session: s.token } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("B.9 — CSRF ausente (HTTP)", () => {
  it("mutação /api/admin sem x-csrf-token → 403", async () => {
    const uid = await makeUser("superadmin");
    const s = await createSession(db, { userId: uid, mfaVerified: true });
    const app = fastify();
    await app.register(cookie);
    app.decorate("db", db);
    app.addHook("preHandler", async (req, reply) => {
      if (req.url.startsWith("/api/admin")) await authMiddleware(req as any);
    });
    app.addHook("preHandler", csrfGuard);
    app.post("/api/admin/ping", async () => ({ ok: true }));
    const res = await app.inject({ method: "POST", url: "/api/admin/ping", cookies: { aa_session: s.token } });
    expect(res.statusCode).toBe(403);
    // com token correto passa
    const ok = await app.inject({ method: "POST", url: "/api/admin/ping", cookies: { aa_session: s.token }, headers: { "x-csrf-token": csrfTokenForSession(s.id) } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });
});
