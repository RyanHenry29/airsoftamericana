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

describe("B0.3 — admin-login não expõe token no corpo e define cookie aa_session HttpOnly", () => {
  it("POST admin login: corpo sem token; Set-Cookie com aa_session e HttpOnly", async () => {
    const app = fastify();
    await app.register(fastifyCookie);
    await routes(app, config, db);
    await app.ready();

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/admin-login",
      headers: { "content-type": "application/json" },
      payload: { email: adminEmail, password: adminPassword },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toMatch(/"token"\s*:/);

    const setCookie = loginRes.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie ?? "");
    expect(cookieStr).toContain("aa_session=");
    expect(cookieStr).toMatch(/HttpOnly/i);

    await app.close();
  });
});
