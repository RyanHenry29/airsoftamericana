// language: TS, file: apps/api/src/middleware/auth.ts, target: Fastify 5
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { unauthorized, forbidden } from "../lib/errors.js";
import { config } from "../config.js";
import { validateSession } from "../services/sessions.js";
import { normalizeRole } from "../lib/rbac.js";
import { cloudflareAccessGuard } from "../lib/cloudflareAccess.js";
import type { Db } from "../db/index.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface JwtPayload {
  sub: string;
  role: string;
  type: "access" | "customer";
}

function toJwtPayload(payload: unknown): JwtPayload {
  const p = payload as { sub?: string; role?: string; type?: string };
  return { sub: p.sub || "", role: p.role || "operator", type: (p.type as any) || "access" };
}

/** JWT mantido apenas para clientes (aa_customer). Admin usa sessão em banco. */
export function signJwt(payload: Omit<JwtPayload, "type"> & { type: "access" | "customer" }): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  return toJwtPayload(payload);
}

function getCookie(request: FastifyRequest, name: string): string | undefined {
  try {
    const cookies = (request as any).cookies;
    if (cookies && cookies[name]) return String(cookies[name]);
  } catch {}
  return undefined;
}

function dbOf(request: FastifyRequest): Db {
  return (request.server as any).db as Db;
}

/**
 * Auth admin: cookie opaco aa_session → hash SHA-256 → sessão em banco.
 * Valida revogação, expiração absoluta (8h) e ociosa (30 min, rolante).
 * Anexa request.user e request.session.
 */
const MFA_SETUP_ALLOW = new Set([
  "/api/admin/csrf",
  "/api/admin/mfa/status",
  "/api/admin/mfa/totp/setup",
  "/api/admin/mfa/totp/confirm",
  "/api/admin/mfa/webauthn/register/options",
  "/api/admin/mfa/webauthn/register/verify",
]);
const MFA_VERIFY_ALLOW = new Set([
  "/api/admin/csrf",
  "/api/admin/mfa/status",
  "/api/admin/mfa/totp/verify",
  "/api/admin/mfa/recovery/verify",
  "/api/admin/mfa/webauthn/auth/options",
  "/api/admin/mfa/webauthn/auth/verify",
]);

function pathAllowed(allow: Set<string>, url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return allow.has(path);
}

export async function authMiddleware(request: FastifyRequest): Promise<void> {
  // Idempotente: registerAuth (onRequest) e preHandlers de rota podem ambos chamar.
  if ((request as any).user && (request as any).session) return;
  const token = getCookie(request, "aa_session");
  if (!token) throw unauthorized();
  const db = dbOf(request);
  if (!db) throw unauthorized();
  const valid = await validateSession(db, token);
  if (!valid) throw unauthorized("Sessão inválida ou expirada");
  const role = normalizeRole(valid.user.role) ?? valid.user.role;
  (request as any).user = { sub: valid.user.id, role, type: "access", email: valid.user.email, mfaEnabled: valid.user.mfaEnabled };
  (request as any).session = valid.session;

  // B.2: gate server-side — MFA obrigatório.
  const url = request.url;
  if (!valid.user.mfaEnabled) {
    if (!pathAllowed(MFA_SETUP_ALLOW, url)) throw forbidden("MFA_SETUP_REQUIRED");
  } else if (!valid.session.mfaVerifiedAt) {
    if (!pathAllowed(MFA_VERIFY_ALLOW, url)) throw forbidden("MFA_VERIFY_REQUIRED");
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest) => {
    const user = (request as any).user;
    if (!user) throw unauthorized();
    if (!roles.includes(user.role)) throw forbidden("Sem permissão para este papel");
  };
}

export async function customerAuthMiddleware(request: FastifyRequest): Promise<void> {
  const token = getCookie(request, "aa_customer");
  if (!token) return;
  try {
    const payload = await verifyJwt(token);
    if (payload.type === "customer") (request as any).customer = { id: payload.sub };
  } catch {
    // token inválido = guest
  }
}

export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/admin")) {
      await cloudflareAccessGuard(req as any, reply);
      if (reply.sent) return;
      await authMiddleware(req as any);
    } else if (req.url.startsWith("/api/auth/me")) {
      await customerAuthMiddleware(req as any);
    }
  });
}
