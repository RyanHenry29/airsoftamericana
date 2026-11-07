// language: TS, file: apps/api/src/routes/mfa.ts, target: Fastify 5
import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  generateTotpSetup,
  verifyTotp,
  verifyTotpWithReplayGuard,
  replaceRecoveryCodes,
  consumeRecoveryCode,
  elevateSessionMfa,
} from "../services/mfa.js";
import { encryptSecret } from "../lib/crypto.js";
import { adminSessionCookieOptions, ADMIN_SESSION_COOKIE } from "../services/sessions.js";
import { config } from "../config.js";

function rpIdFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

export function registerMfaRoutes(app: FastifyInstance, db: Db): void {
  const A = authMiddleware;
  const rpName = "Airsoft Americana";
  const rpID = rpIdFromUrl(config.ADMIN_URL || config.STORE_URL || "http://localhost:3001");
  const origin = config.ADMIN_URL || `http://localhost:3001`;

  // Status (permitido durante gate)
  app.get("/api/admin/mfa/status", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string; mfaEnabled: boolean };
    const session = (request as any).session as { mfaVerifiedAt: Date | null };
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.sub)).limit(1);
    const passkeys = await db.select({ id: schema.webauthnCredentials.id }).from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, user.sub));
    reply.send({
      mfaEnabled: !!row?.mfaEnabled,
      sessionMfaVerified: !!session?.mfaVerifiedAt,
      hasTotp: !!row?.totpSecret,
      passkeyCount: passkeys.length,
    });
  });

  // ---- TOTP setup (gera segredo + URI; não habilita até confirmar)
  app.post("/api/admin/mfa/totp/setup", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string; email: string };
    const setup = generateTotpSetup(user.email);
    // guarda segredo cifrado temporariamente no próprio user.totpSecret mas mantém mfaEnabled false
    // (substitui a cada setup; só vira "ativo" no confirm)
    await db.update(schema.users).set({ totpSecret: setup.encryptedSecret }).where(eq(schema.users.id, user.sub));
    reply.send({ otpauthUrl: setup.otpauthUrl });
  });

  // ---- TOTP confirm: verifica, habilita MFA, gera recovery codes, eleva sessão
  app.post("/api/admin/mfa/totp/confirm", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string };
    const session = (request as any).session as { id: string };
    const body = (request.body ?? {}) as { code?: string };
    const code = String(body.code ?? "");
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.sub)).limit(1);
    if (!row?.totpSecret) return reply.status(400).send({ error: { code: "mfa_not_setup", message: "Inicie a configuração do TOTP primeiro" } });
    if (!(await verifyTotpWithReplayGuard(db, user.sub, row.totpSecret, code))) {
      return reply.status(400).send({ error: { code: "mfa_invalid", message: "Código TOTP inválido" } });
    }
    const recoveryCodes = await replaceRecoveryCodes(db, user.sub);
    await db.update(schema.users).set({ mfaEnabled: true }).where(eq(schema.users.id, user.sub));
    const next = await elevateSessionMfa(db, session.id, user.sub, request.ip, request.headers["user-agent"] ?? null);
    reply.setCookie(ADMIN_SESSION_COOKIE, next.token, adminSessionCookieOptions(config.NODE_ENV === "production"));
    reply.send({ ok: true, recoveryCodes });
  });

  // ---- TOTP verify (login step, sessão existente mas não verificada)
  app.post("/api/admin/mfa/totp/verify", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string };
    const session = (request as any).session as { id: string };
    const body = (request.body ?? {}) as { code?: string };
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.sub)).limit(1);
    if (!row?.mfaEnabled || !row.totpSecret) return reply.status(400).send({ error: { code: "mfa_not_enabled", message: "MFA não configurado" } });
    if (!(await verifyTotpWithReplayGuard(db, user.sub, row.totpSecret, String(body.code ?? "")))) {
      return reply.status(401).send({ error: { code: "mfa_invalid", message: "Código TOTP inválido" } });
    }
    const next = await elevateSessionMfa(db, session.id, user.sub, request.ip, request.headers["user-agent"] ?? null);
    reply.setCookie(ADMIN_SESSION_COOKIE, next.token, adminSessionCookieOptions(config.NODE_ENV === "production"));
    reply.send({ ok: true });
  });

  // ---- Recovery code verify (single-use)
  app.post("/api/admin/mfa/recovery/verify", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string };
    const session = (request as any).session as { id: string };
    const body = (request.body ?? {}) as { code?: string };
    const ok = await consumeRecoveryCode(db, user.sub, String(body.code ?? ""));
    if (!ok) return reply.status(401).send({ error: { code: "mfa_invalid", message: "Código de recuperação inválido ou já utilizado" } });
    // recovery usado conta como verificação MFA da sessão
    await db.update(schema.users).set({ mfaEnabled: true }).where(eq(schema.users.id, user.sub));
    const next = await elevateSessionMfa(db, session.id, user.sub, request.ip, request.headers["user-agent"] ?? null);
    reply.setCookie(ADMIN_SESSION_COOKIE, next.token, adminSessionCookieOptions(config.NODE_ENV === "production"));
    reply.send({ ok: true });
  });

  // ---- WebAuthn register options (setup)
  app.post("/api/admin/mfa/webauthn/register/options", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string; email: string };
    const session = (request as any).session as { id: string };
    const existing = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, user.sub));
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.email,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    await db.update(schema.sessions).set({ mfaChallenge: options.challenge }).where(eq(schema.sessions.id, session.id));
    reply.send(options);
  });

  // ---- WebAuthn register verify
  app.post("/api/admin/mfa/webauthn/register/verify", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string };
    const session = (request as any).session as { id: string; mfaChallenge?: string | null };
    const [sess] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, session.id)).limit(1);
    const expectedChallenge = sess?.mfaChallenge;
    if (!expectedChallenge) return reply.status(400).send({ error: { code: "mfa_challenge_missing", message: "Desafio ausente — inicie o registro novamente" } });
    try {
      const verification = await verifyRegistrationResponse({
        response: request.body as any,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return reply.status(400).send({ error: { code: "mfa_invalid", message: "Registro de passkey falhou" } });
      }
      const { credential } = verification.registrationInfo;
      await db.insert(schema.webauthnCredentials).values({
        userId: user.sub,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        label: "Passkey",
      });
      await db.update(schema.sessions).set({ mfaChallenge: null }).where(eq(schema.sessions.id, session.id));
      // Se já tinha TOTP/recovery ou é o primeiro fator, habilita MFA e gera recovery se ainda não tiver
      const codes = await db.select({ id: schema.mfaRecoveryCodes.id }).from(schema.mfaRecoveryCodes).where(and(eq(schema.mfaRecoveryCodes.userId, user.sub), isNull(schema.mfaRecoveryCodes.usedAt)));
      let recoveryCodes: string[] | undefined;
      if (codes.length === 0) recoveryCodes = await replaceRecoveryCodes(db, user.sub);
      await db.update(schema.users).set({ mfaEnabled: true }).where(eq(schema.users.id, user.sub));
      const next = await elevateSessionMfa(db, session.id, user.sub, request.ip, request.headers["user-agent"] ?? null);
      reply.setCookie(ADMIN_SESSION_COOKIE, next.token, adminSessionCookieOptions(config.NODE_ENV === "production"));
      reply.send({ ok: true, recoveryCodes });
    } catch (e: any) {
      return reply.status(400).send({ error: { code: "mfa_invalid", message: e?.message || "Registro de passkey falhou" } });
    }
  });

  // ---- WebAuthn auth options (verify step)
  app.post("/api/admin/mfa/webauthn/auth/options", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string };
    const session = (request as any).session as { id: string };
    const creds = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, user.sub));
    if (!creds.length) return reply.status(400).send({ error: { code: "mfa_not_enabled", message: "Nenhuma passkey registrada" } });
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      userVerification: "preferred",
    });
    await db.update(schema.sessions).set({ mfaChallenge: options.challenge }).where(eq(schema.sessions.id, session.id));
    reply.send(options);
  });

  // ---- WebAuthn auth verify
  app.post("/api/admin/mfa/webauthn/auth/verify", { preHandler: [A] }, async (request, reply) => {
    const user = (request as any).user as { sub: string };
    const session = (request as any).session as { id: string };
    const [sess] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, session.id)).limit(1);
    const expectedChallenge = sess?.mfaChallenge;
    if (!expectedChallenge) return reply.status(400).send({ error: { code: "mfa_challenge_missing", message: "Desafio ausente" } });
    const body = request.body as any;
    const credId = body?.id || body?.rawId;
    const [cred] = await db.select().from(schema.webauthnCredentials).where(and(eq(schema.webauthnCredentials.userId, user.sub), eq(schema.webauthnCredentials.credentialId, credId))).limit(1);
    if (!cred) return reply.status(400).send({ error: { code: "mfa_invalid", message: "Passkey não reconhecida" } });
    try {
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: cred.credentialId,
          publicKey: Buffer.from(cred.publicKey, "base64url"),
          counter: cred.counter,
          transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        },
      });
      if (!verification.verified) return reply.status(401).send({ error: { code: "mfa_invalid", message: "Passkey inválida" } });
      await db.update(schema.webauthnCredentials).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(schema.webauthnCredentials.id, cred.id));
      await db.update(schema.sessions).set({ mfaChallenge: null }).where(eq(schema.sessions.id, session.id));
      const next = await elevateSessionMfa(db, session.id, user.sub, request.ip, request.headers["user-agent"] ?? null);
      reply.setCookie(ADMIN_SESSION_COOKIE, next.token, adminSessionCookieOptions(config.NODE_ENV === "production"));
      reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(400).send({ error: { code: "mfa_invalid", message: e?.message || "Verificação de passkey falhou" } });
    }
  });
}
