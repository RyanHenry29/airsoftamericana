import { describe, it, expect } from "vitest";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { csrfGuard, csrfTokenFor, csrfTokenForSession } from "./csrf.js";

describe("B.3 — CSRF", () => {
  it("gera token determinístico por sessão e rejeita outro", () => {
    const a = csrfTokenFor("sessao-a");
    const b = csrfTokenFor("sessao-a");
    const c = csrfTokenFor("sessao-b");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("bloqueia mutação /api/admin sem header x-csrf-token", async () => {
    const app = fastify();
    await app.register(cookie);
    app.addHook("preHandler", csrfGuard);
    app.post("/api/admin/things", async () => ({ ok: true }));
    const token = "fake-session";
    const res = await app.inject({ method: "POST", url: "/api/admin/things", cookies: { aa_session: token } });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    const msg = JSON.stringify(body).toLowerCase();
    expect(msg).toContain("csrf");
    await app.close();
  });

  it("aceita mutação com header correto e ignora GET", async () => {
    const app = fastify();
    await app.register(cookie);
    app.addHook("preHandler", csrfGuard);
    app.post("/api/admin/things", async () => ({ ok: true }));
    app.get("/api/admin/things", async () => ({ ok: true }));
    const session = "fake-session";
    const csrf = csrfTokenFor(session);
    const post = await app.inject({ method: "POST", url: "/api/admin/things", cookies: { aa_session: session }, headers: { "x-csrf-token": csrf } });
    expect(post.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/admin/things", cookies: { aa_session: session } });
    expect(get.statusCode).toBe(200);
    await app.close();
  });

  it("B.1: aceita token CSRF ligado ao id da sessão (request.session)", async () => {
    const app = fastify();
    await app.register(cookie);
    app.addHook("preHandler", async (req) => {
      if (req.url.startsWith("/api/admin")) (req as any).session = { id: "sess-uuid-123" };
    });
    app.addHook("preHandler", csrfGuard);
    app.post("/api/admin/things", async () => ({ ok: true }));
    const csrf = csrfTokenForSession("sess-uuid-123");
    const ok = await app.inject({ method: "POST", url: "/api/admin/things", headers: { "x-csrf-token": csrf } });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({ method: "POST", url: "/api/admin/things", headers: { "x-csrf-token": csrfTokenForSession("outra") } });
    expect(bad.statusCode).toBe(403);
    await app.close();
  });
});
