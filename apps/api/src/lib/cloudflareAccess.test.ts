// language: TS, file: apps/api/src/lib/cloudflareAccess.test.ts, target: vitest
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fastify from "fastify";
import { cloudflareAccessGuard, cfAccessEnabled } from "./cloudflareAccess.js";
import { config } from "../config.js";

const origNodeEnv = config.NODE_ENV;
const origTeam = config.CF_ACCESS_TEAM_DOMAIN;
const origAud = config.CF_ACCESS_AUD;

function set(key: keyof typeof config, val: any) { (config as any)[key] = val; }

beforeEach(() => {
  set("CF_ACCESS_TEAM_DOMAIN", "testteam.cloudflareaccess.com");
  set("CF_ACCESS_AUD", "aud-123");
});
afterEach(() => {
  set("NODE_ENV", origNodeEnv);
  set("CF_ACCESS_TEAM_DOMAIN", origTeam);
  set("CF_ACCESS_AUD", origAud);
});

describe("B.5 — Cloudflare Access", () => {
  it("opção desligada não bloqueia", async () => {
    set("CF_ACCESS_TEAM_DOMAIN", "");
    set("CF_ACCESS_AUD", "");
    expect(cfAccessEnabled()).toBe(false);
    const app = fastify();
    app.addHook("onRequest", cloudflareAccessGuard);
    app.get("/api/admin/ping", async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/api/admin/ping" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("produção + opção ligada + header ausente → 404", async () => {
    set("NODE_ENV", "production");
    const app = fastify();
    app.addHook("onRequest", cloudflareAccessGuard);
    app.get("/api/admin/ping", async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/api/admin/ping" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("produção + opção ligada + header inválido → 404 (não vaza existência)", async () => {
    set("NODE_ENV", "production");
    const app = fastify();
    app.addHook("onRequest", cloudflareAccessGuard);
    app.get("/api/admin/ping", async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/api/admin/ping", headers: { "cf-access-jwt-assertion": "not-a-jwt" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("não afeta rotas fora de /api/admin", async () => {
    set("NODE_ENV", "production");
    const app = fastify();
    app.addHook("onRequest", cloudflareAccessGuard);
    app.get("/api/store/ping", async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/api/store/ping" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
