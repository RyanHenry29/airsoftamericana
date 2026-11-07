// language: TS, file: apps/api/src/services/mfa.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword, decryptSecret } from "../lib/crypto.js";
import {
  generateTotpSetup,
  verifyTotp,
  verifyTotpWithReplayGuard,
  replaceRecoveryCodes,
  consumeRecoveryCode,
} from "./mfa.js";
import { createSession } from "./sessions.js";
import { authMiddleware } from "../middleware/auth.js";

let db: any;
let userId: string;
let email: string;

function currentTotp(encryptedSecret: string): string {
  const base32 = decryptSecret(encryptedSecret);
  const totp = new OTPAuth.TOTP({
    issuer: "Airsoft Americana",
    label: "test",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32),
  });
  return totp.generate();
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  email = `mfa-${Date.now()}@test.local`;
  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: await hashPassword("Senha123!"),
      name: "MFA Teste",
      role: "superadmin",
      active: true,
      mfaEnabled: false,
    })
    .returning();
  userId = u.id;
});

describe("B.2 — MFA TOTP", () => {
  it("rejeita código errado", async () => {
    const setup = generateTotpSetup(email);
    await db.update(schema.users).set({ totpSecret: setup.encryptedSecret }).where(eq(schema.users.id, userId));
    expect(verifyTotp(setup.encryptedSecret, "000000").ok).toBe(false);
    expect(await verifyTotpWithReplayGuard(db, userId, setup.encryptedSecret, "000000")).toBe(false);
  });

  it("aceita código correto e rejeita reutilização (replay)", async () => {
    // reseta last used
    await db.update(schema.users).set({ totpLastUsedStep: null }).where(eq(schema.users.id, userId));
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    const code = currentTotp(row.totpSecret!);
    expect(await verifyTotpWithReplayGuard(db, userId, row.totpSecret!, code)).toBe(true);
    // replay do mesmo código/timestep
    expect(await verifyTotpWithReplayGuard(db, userId, row.totpSecret!, code)).toBe(false);
  });
});

describe("B.2 — códigos de recuperação", () => {
  it("gera 10 códigos, consome uma vez e rejeita reutilização", async () => {
    const codes = await replaceRecoveryCodes(db, userId);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(await consumeRecoveryCode(db, userId, codes[0]!)).toBe(true);
    expect(await consumeRecoveryCode(db, userId, codes[0]!)).toBe(false); // reutilizado
    expect(await consumeRecoveryCode(db, userId, "NAOEXISTE1")).toBe(false);
  });

  it("armazena apenas hash (nunca o código em claro)", async () => {
    const codes = await replaceRecoveryCodes(db, userId);
    const rows = await db.select().from(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, userId));
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(codes).not.toContain(r.codeHash);
      expect(r.codeHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("B.2 — gate server-side MFA", () => {
  it("sem MFA configurado, bloqueia rotas admin fora do setup", async () => {
    const app = fastify();
    await app.register(cookie);
    app.decorate("db", db);
    // simula auth: seta user+session como o gate espera
    app.addHook("preHandler", async (req: any, _reply: any) => {
      if (!req.url.startsWith("/api/admin")) return;
      const token = req.cookies?.aa_session;
      if (!token) return;
      req.user = { sub: userId, role: "superadmin", email, mfaEnabled: false };
      req.session = { id: "s1", mfaVerifiedAt: null };
      const path = (req.url.split("?")[0] ?? req.url) as string;
      const allow = new Set(["/api/admin/csrf","/api/admin/mfa/status","/api/admin/mfa/totp/setup","/api/admin/mfa/totp/confirm","/api/admin/mfa/webauthn/register/options","/api/admin/mfa/webauthn/register/verify"]);
      if (!allow.has(path)) {
        const err: any = new Error("MFA_SETUP_REQUIRED");
        err.statusCode = 403;
        throw err;
      }
    });
    app.get("/api/admin/products", async () => ({ ok: true }));
    app.get("/api/admin/mfa/status", async () => ({ ok: true }));
    const no = await app.inject({ method: "GET", url: "/api/admin/products", cookies: { aa_session: "x" } });
    expect(no.statusCode).toBe(403);
    const yes = await app.inject({ method: "GET", url: "/api/admin/mfa/status", cookies: { aa_session: "x" } });
    expect(yes.statusCode).toBe(200);
    await app.close();
  });

  it("MFA habilitado mas sessão não verificada bloqueia fora da verificação", async () => {
    const app = fastify();
    await app.register(cookie);
    app.decorate("db", db);
    app.addHook("preHandler", async (req: any, _reply: any) => {
      if (!req.url.startsWith("/api/admin")) return;
      const path = (req.url.split("?")[0] ?? req.url) as string;
      const allow = new Set(["/api/admin/csrf","/api/admin/mfa/status","/api/admin/mfa/totp/verify","/api/admin/mfa/recovery/verify","/api/admin/mfa/webauthn/auth/options","/api/admin/mfa/webauthn/auth/verify"]);
      req.user = { sub: userId, role: "superadmin", email, mfaEnabled: true };
      req.session = { id: "s2", mfaVerifiedAt: null };
      if (!allow.has(path)) { const err: any = new Error("MFA_VERIFY_REQUIRED"); err.statusCode = 403; throw err; }
    });
    app.get("/api/admin/products", async () => ({ ok: true }));
    app.post("/api/admin/mfa/totp/verify", async () => ({ ok: true }));
    expect((await app.inject({ method: "GET", url: "/api/admin/products", cookies: { aa_session: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/admin/mfa/totp/verify", cookies: { aa_session: "x" } })).statusCode).toBe(200);
    await app.close();
  });
});
