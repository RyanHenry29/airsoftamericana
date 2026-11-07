import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { routes } from "../routes/index.js";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import bcrypt from "bcryptjs";

let db: any;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  // usuário admin de teste com hash bcrypt de "Admin123!"
  const password = "Admin123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const email = `admin-test-${Date.now()}@airsoftamericana.com.br`;
  await db.insert(schema.users).values({
    email,
    passwordHash,
    name: "Admin Teste",
    role: "admin",
    active: true,
  });
});

describe("B0.3 — admin-login não expõe token no corpo da resposta", () => {
  it("admin login returns user without token in body and sets HttpOnly cookie", async () => {
    const app = fastify();
    await app.register(fastifyCookie);
    await routes(app, config, db);
    // Login as admin with valid credentials (use the same test email)
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/admin-login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `admin-test-${Date.now()}@airsoftamericana.com.br`,
        password: "Admin123!",
      }),
    });
    const loginBody = loginRes.json() as {
      user: { id: string; name: string; email: string; role: string };
      mfaRequired: boolean;
      mfaSetupRequired: boolean;
    };
    expect(loginRes.statusCode).toBe(200);
    expect(loginBody.user).toBeDefined();
    expect(loginBody.user.email).toContain("airsoftamericana.com.br");
    // Verify cookie was set and is HttpOnly (no token in body)
    const setCookieHeader = loginRes.headers["set-cookie"]?.[0];
    expect(setCookieHeader).toContain("HttpOnly");
    // The response body should not contain token
    const bodyStr = JSON.stringify(loginBody);
    expect(bodyStr).not.toMatch(/"token"/);
  });
});