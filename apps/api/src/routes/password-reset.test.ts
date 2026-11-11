// language: TS, file: apps/api/src/routes/password-reset.test.ts, target: vitest
// "Esqueci a senha": 503 sem provedor, resposta genérica anti-enumeration,
// hash (nunca token cru), queima de token, expiração, reuso e rate-limit.
// O fetch do Resend é mockado — o token só existe no corpo do e-mail enviado.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import { eq, count } from "drizzle-orm";
import { routes } from "./index.js";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword, verifyPasswordDetailed, sha256 } from "../lib/crypto.js";

let db: any;

const EMAIL = `reset-owner-${Date.now()}@airsoftamericana.com.br`;
const OLD_PASSWORD = "SenhaAntiga123!";
const NEW_PASSWORD = "NovaSenha456!";
let customerId = "";

// ── apps: uma por bloco — cada uma registra as regras do seu config ─────────
const cfgNoMail = { ...config, RESEND_API_KEY: "" } as typeof config;
const cfgMain = { ...config, RESEND_API_KEY: "re_teste_nao_real", AUTH_LOGIN_MAX: 100 } as typeof config;
const cfgTight = { ...config, RESEND_API_KEY: "re_teste_nao_real", AUTH_LOGIN_MAX: 1 } as typeof config;

async function buildApp(cfg: typeof config) {
  const instance = fastify();
  await instance.register(fastifyCookie);
  await routes(instance, cfg, db);
  await instance.ready();
  return instance;
}

// IPs distintos por bloco: o balde do rate-limit é scope:ip e os testes do
// arquivo compartilham o mesmo processo.
const IP_MAIN = "10.1.0.2";
const IP_NOMAIL = "10.1.0.1";
const IP_TIGHT = "10.1.0.3";
const IP_LOGIN = "10.1.0.4";

// ── mock do Resend: captura o payload enviado (daí sai o token) ─────────────
type SentMail = { to: string[]; from: string; subject: string; text: string; html: string };
const sent: SentMail[] = [];
let mailOk = true;

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes("api.resend.com")) {
      throw new Error(`fetch inesperado no teste de redefinição: ${String(url)}`);
    }
    if (!mailOk) return { ok: false, status: 502, text: async () => "upstream down" } as Response;
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return { ok: true, status: 200, text: async () => "" } as Response;
  }));

  db = await getDb();
  await migrate(db);
  const rows = await db
    .insert(schema.customers)
    .values({ name: "Joana Reset", email: EMAIL, passwordHash: await hashPassword(OLD_PASSWORD) })
    .returning();
  customerId = rows[0].id;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Extrai o token do link como o cliente receberia no e-mail. */
function tokenFromMail(index: number): string {
  const mail = sent[index];
  const match = mail?.text.match(/redefinir-senha\?token=([^\s]+)/);
  if (!match?.[1]) throw new Error(`token não encontrado no e-mail #${index}`);
  return match[1];
}

async function forgot(app: any, email: string, remoteAddress = IP_MAIN) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/forgot-password",
    remoteAddress,
    payload: { email },
  });
  return { status: res.statusCode, body: res.json() };
}

async function reset(app: any, token: string, password: string, remoteAddress = IP_MAIN) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    remoteAddress,
    payload: { token, password },
  });
  return { status: res.statusCode, body: res.json() };
}

describe("POST /api/auth/forgot-password", () => {
  it("503 rotulado quando RESEND_API_KEY não está configurada (não finge envio)", async () => {
    const app = await buildApp(cfgNoMail);
    const before = (await db.select({ n: count() }).from(schema.passwordResets))[0].n;
    const { status, body } = await forgot(app, EMAIL, IP_NOMAIL);
    expect(status).toBe(503);
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toContain("RESEND_API_KEY");
    // nada foi criado nem enviado
    const after = (await db.select({ n: count() }).from(schema.passwordResets))[0].n;
    expect(after).toBe(before);
    expect(sent).toHaveLength(0);
  });

  it("400 para e-mail malformado", async () => {
    const app = await buildApp(cfgMain);
    const { status, body } = await forgot(app, "nao-e-email", IP_MAIN);
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_input");
  });

  it("e-mail inexistente: 200 genérico, sem token e sem chamada ao provedor", async () => {
    const app = await buildApp(cfgMain);
    const { status, body } = await forgot(app, "ninguem-cadastrado@airsoftamericana.com.br", IP_MAIN);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(sent).toHaveLength(0);
    const rows = await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.customerId, customerId));
    expect(rows).toHaveLength(0);
    // guarda o corpo pra comparar com a resposta do e-mail existente
    (globalThis as any).__unknownBody = body;
  });

  it("e-mail existente: mesma resposta genérica + token enviado, banco guarda só o hash", async () => {
    const app = await buildApp(cfgMain);
    const { status, body } = await forgot(app, EMAIL, IP_MAIN);
    expect(status).toBe(200);
    // anti-enumeration: idêntica à resposta do e-mail inexistente
    expect(body).toEqual((globalThis as any).__unknownBody);

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toEqual([EMAIL]);
    expect(mail.from).toContain("Airsoft Americana");
    expect(mail.subject).toContain("Redefinição de senha");

    const token = tokenFromMail(0);
    const rows = await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.customerId, customerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(token)); // hash, nunca o cru
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toHaveLength(64);
    expect(rows[0].usedAt).toBeNull();
    // TTL de 60 minutos
    const ttl = rows[0].expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60 * 1000);
    expect(ttl).toBeLessThan(61 * 60 * 1000);
  });

  it("pedir de novo queima o link anterior", async () => {
    const app = await buildApp(cfgMain);
    const token1 = tokenFromMail(0);
    const { status } = await forgot(app, EMAIL, IP_MAIN);
    expect(status).toBe(200);
    expect(sent).toHaveLength(2);

    const burnt = await reset(app, token1, NEW_PASSWORD);
    expect(burnt.status).toBe(400);
    expect(burnt.body.error.code).toBe("link_invalid");
  });

  it("falha do provedor de e-mail não muda a resposta e vai pra outbox", async () => {
    const app = await buildApp(cfgMain);
    mailOk = false;
    const { status, body } = await forgot(app, EMAIL, IP_MAIN);
    mailOk = true;
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const notices = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, "mail.password_reset_failed"));
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[0].severity).toBe("warning");
  });
});

describe("POST /api/auth/reset-password", () => {
  // O bloco anterior terminou pedindo redefinições (queima o link anterior) —
  // minto um link fresco aqui e conduzo todo o fluxo com ele.
  let freshToken = "";

  it("400 para senha curta, token ausente e token desconhecido", async () => {
    const app = await buildApp(cfgMain);
    const mint = await forgot(app, EMAIL, IP_MAIN);
    expect(mint.status).toBe(200);
    freshToken = tokenFromMail(sent.length - 1);

    const weak = await reset(app, freshToken, "curta");
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("invalid_input");

    const noToken = await reset(app, "", NEW_PASSWORD);
    expect(noToken.status).toBe(400);

    const unknown = await reset(app, "a".repeat(32), NEW_PASSWORD);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("link_invalid");
    // nenhuma das recusas consumiu o link
    const still = (await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.tokenHash, sha256(freshToken))))[0];
    expect(still.usedAt).toBeNull();
  });

  it("troca a senha com o link válido e queima o token", async () => {
    const app = await buildApp(cfgMain);
    const { status, body } = await reset(app, freshToken, NEW_PASSWORD);
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const row = (await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0];
    expect((await verifyPasswordDetailed(OLD_PASSWORD, row.passwordHash)).ok).toBe(false);
    expect((await verifyPasswordDetailed(NEW_PASSWORD, row.passwordHash)).ok).toBe(true);

    const used = (await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.tokenHash, sha256(freshToken))))[0];
    expect(used.usedAt).not.toBeNull();
  });

  it("login do cliente aceita a senha nova e recusa a antiga", async () => {
    const app = await buildApp(cfgMain);
    const old = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: IP_LOGIN,
      payload: { email: EMAIL, password: OLD_PASSWORD },
    });
    expect(old.statusCode).toBe(401);

    const fresh = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: IP_LOGIN,
      payload: { email: EMAIL, password: NEW_PASSWORD },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().customer.email).toBe(EMAIL);
  });
  it("reuso do mesmo link responde 400 (consumo atômico)", async () => {
    const app = await buildApp(cfgMain);
    const again = await reset(app, freshToken, "OutraSenha789!");
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("link_invalid");
    // a senha não mudou com o reuso
    const row = (await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0];
    expect((await verifyPasswordDetailed(NEW_PASSWORD, row.passwordHash)).ok).toBe(true);
  });

  it("link expirado responde 400 rotulado e não toca na senha", async () => {
    const app = await buildApp(cfgMain);
    await forgot(app, EMAIL, IP_MAIN);
    const token3 = tokenFromMail(sent.length - 1);
    await db
      .update(schema.passwordResets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.passwordResets.tokenHash, sha256(token3)));

    const { status, body } = await reset(app, token3, "SenhaExpirada1!");
    expect(status).toBe(400);
    expect(body.error.code).toBe("link_expired");
    expect(body.error.message).toContain("expirou");

    const row = (await db.select().from(schema.customers).where(eq(schema.customers.id, customerId)))[0];
    expect((await verifyPasswordDetailed(NEW_PASSWORD, row.passwordHash)).ok).toBe(true);
  });
});

describe("rate-limit do esqueci a senha", () => {
  it("segunda solicitação na mesma janela responde 429 com retry-after", async () => {
    const app = await buildApp(cfgTight);
    const first = await forgot(app, "ninguem-cadastrado@airsoftamericana.com.br", IP_TIGHT);
    expect(first.status).toBe(200);

    const second = await forgot(app, "ninguem-cadastrado@airsoftamericana.com.br", IP_TIGHT);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("rate_limited");
    expect(second.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });
});
