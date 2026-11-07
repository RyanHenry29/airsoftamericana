// language: TS, file: apps/api/src/services/mfa.ts, target: Fastify 5
import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { encryptSecret, decryptSecret, sha256 } from "../lib/crypto.js";
import { rotateSession } from "./sessions.js";

const ISSUER = "Airsoft Americana";

export function buildTotp(secretBase32: string, account: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: account,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function generateTotpSetup(account: string) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = buildTotp(secret.base32, account);
  return {
    secretBase32: secret.base32,
    encryptedSecret: encryptSecret(secret.base32),
    otpauthUrl: totp.toString(),
  };
}

export function verifyTotp(encryptedSecret: string, token: string): { ok: boolean; step?: number } {
  try {
    const base32 = decryptSecret(encryptedSecret);
    const totp = buildTotp(base32, "user");
    const clean = token.replace(/\s+/g, "");
    const delta = totp.validate({ token: clean, window: 1 });
    if (delta === null) return { ok: false };
    // timestep usado (aprox): now/period + delta
    const step = Math.floor(Date.now() / 30000) + delta;
    return { ok: true, step };
  } catch {
    return { ok: false };
  }
}

/** Verifica TOTP com proteção anti-replay (mesmo timestep não aceito duas vezes). */
export async function verifyTotpWithReplayGuard(db: Db, userId: string, encryptedSecret: string, token: string): Promise<boolean> {
  const v = verifyTotp(encryptedSecret, token);
  if (!v.ok || v.step === undefined) return false;
  const [row] = await db.select({ last: schema.users.totpLastUsedStep }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (row && row.last !== null && row.last !== undefined && row.last >= v.step) return false; // replay
  await db.update(schema.users).set({ totpLastUsedStep: v.step }).where(eq(schema.users.id, userId));
  return true;
}

export function generateRecoveryCodes(count = 10): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 10 chars base32-ish, legível, exibido uma vez
    const raw = crypto.randomBytes(8).toString("base64url").slice(0, 10).toUpperCase();
    plain.push(raw);
    hashes.push(sha256(raw));
  }
  return { plain, hashes };
}

/** Consome código de recuperação (uso único). Retorna true se válido e consumido. */
export async function consumeRecoveryCode(db: Db, userId: string, code: string): Promise<boolean> {
  const h = sha256(code.trim().toUpperCase());
  const rows = await db
    .select()
    .from(schema.mfaRecoveryCodes)
    .where(and(eq(schema.mfaRecoveryCodes.userId, userId), eq(schema.mfaRecoveryCodes.codeHash, h), isNull(schema.mfaRecoveryCodes.usedAt)));
  const row = rows[0];
  if (!row) return false;
  // single-use: marca usado; condição garante que corrida não reutiliza
  const updated = await db
    .update(schema.mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.mfaRecoveryCodes.id, row.id), isNull(schema.mfaRecoveryCodes.usedAt)))
    .returning();
  return updated.length > 0;
}

export async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const { plain, hashes } = generateRecoveryCodes(10);
  await db.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, userId));
  if (hashes.length) {
    await db.insert(schema.mfaRecoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
  }
  return plain;
}

/**
 * Marca sessão como MFA-verificada e rotaciona o token (elevação de privilégio).
 */
export async function elevateSessionMfa(
  db: Db,
  sessionId: string,
  userId: string,
  ip?: string | null,
  userAgent?: string | null,
) {
  return rotateSession(db, sessionId, { userId, ip, userAgent, mfaVerified: true, mfaElevated: true });
}
