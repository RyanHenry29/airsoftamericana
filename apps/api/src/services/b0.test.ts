import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { routes } from "../routes/index.js";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";

let db: any;
const adminEmail = `b0-admin-${Date.now()}@airsoftamericana.com.br`;
const adminPassword = "Admin123!";

async function buildApp(cfg: any) {
  const app = fastify();
  await app.register(fastifyCookie);
  await routes(app, cfg, db);
  await app.ready();
  return app;
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  await db.insert(schema.users).values({
    email: adminEmail,
    passwordHash: await hashPassword(adminPassword),
    name: "Admin B0",
    role: "superadmin",
    active: true,
    mfaEnabled: false,
  });
});

describe("B0.3 — admin-login via HTTP real (app.inject): sem token no corpo, cookie aa_session seguro", () => {
  it("corpo sem token; Set-Cookie aa_session HttpOnly, SameSite=Strict; Secure ausente fora de produção", async () => {
    const app = await buildApp(config);
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/admin-login",
      headers: { "content-type": "application/json" },
      payload: { email: adminEmail, password: adminPassword },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("token");

    const setCookie = loginRes.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
    expect(cookieStr).toContain("aa_session=");
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=Strict/i);
    expect(cookieStr).not.toMatch(/;\s*Secure/i); // NODE_ENV=test

    await app.close();
  });

  it("em produção, cookie aa_session inclui Secure (HTTP real, config de produção)", async () => {
    const prodConfig = { ...config, NODE_ENV: "production", isProd: true };
    const app = await buildApp(prodConfig);
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/admin-login",
      headers: { "content-type": "application/json" },
      payload: { email: adminEmail, password: adminPassword },
    });

    expect(loginRes.statusCode).toBe(200);
    const setCookie = loginRes.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
    expect(cookieStr).toContain("aa_session=");
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=Strict/i);
    expect(cookieStr).toMatch(/;\s*Secure/i);

    await app.close();
  });
});
