// language: TS, file: apps/api/src/routes/customer-session.test.ts, target: vitest
// Sessão do cliente no login: remember=false emite cookie de sessão (sem
// Max-Age — some ao fechar o navegador); remember=true e o default (cliente
// antigo que não envia o campo) mantêm Max-Age de 7 dias. HttpOnly sempre.
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { routes } from "./index.js";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";

let db: any;

const EMAIL = `sessao-${Date.now()}@airsoftamericana.com.br`;
const PASSWORD = "SenhaForte123!";

// Login é rate-limit scope:ip — cada teste usa IP próprio.
const cfg = { ...config, RESEND_API_KEY: "", AUTH_LOGIN_MAX: 100 } as typeof config;

async function buildApp() {
  const instance = fastify();
  await instance.register(fastifyCookie);
  await routes(instance, cfg, db);
  await instance.ready();
  return instance;
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  await db.insert(schema.customers).values({
    name: "Cliente Sessão",
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
  });
});

function loginAs(app: any, body: Record<string, unknown>, ip: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: ip,
    headers: { "content-type": "application/json" },
    payload: { email: EMAIL, password: PASSWORD, ...body },
  });
}

function customerCookieOf(res: any): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.find((c: string) => c.startsWith("aa_customer=")) ?? "";
}

describe("cookie aa_customer no login do cliente", () => {
  it("remember=false: cookie de sessão — sem Max-Age, com HttpOnly", async () => {
    const app = await buildApp();
    const res = await loginAs(app, { remember: false }, "10.11.0.1");
    expect(res.statusCode).toBe(200);
    const cookie = customerCookieOf(res);
    expect(cookie).toContain("aa_customer=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Max-Age=/i);
    await app.close();
  });

  it("remember=true: cookie persistente com Max-Age de 7 dias", async () => {
    const app = await buildApp();
    const res = await loginAs(app, { remember: true }, "10.11.0.2");
    expect(res.statusCode).toBe(200);
    const cookie = customerCookieOf(res);
    expect(cookie).toContain("aa_customer=");
    expect(cookie).toMatch(/Max-Age=604800/i);
    await app.close();
  });

  it("sem remember (cliente antigo): mantém Max-Age de 7 dias", async () => {
    const app = await buildApp();
    const res = await loginAs(app, {}, "10.11.0.3");
    expect(res.statusCode).toBe(200);
    const cookie = customerCookieOf(res);
    expect(cookie).toContain("aa_customer=");
    expect(cookie).toMatch(/Max-Age=604800/i);
    await app.close();
  });

  it("remember com tipo errado: 400 invalid_input (schema revalida)", async () => {
    const app = await buildApp();
    const res = await loginAs(app, { remember: "sim" }, "10.11.0.4");
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe("invalid_input");
    await app.close();
  });
});
