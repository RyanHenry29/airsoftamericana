// language: TS, file: apps/api/src/lib/csrf.ts, target: Fastify 5
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { forbidden } from "./errors.js";
import { config } from "../config.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF ligado ao id da sessão (estável entre leituras; muda na rotação). */
export function csrfTokenForSession(sessionId: string): string {
  return crypto.createHmac("sha256", config.JWT_SECRET).update(`csrf:sid:${sessionId}`).digest("base64url");
}

/** Legado: derivado do token cru (transição). */
export function csrfTokenFor(sessionToken: string): string {
  return crypto.createHmac("sha256", config.JWT_SECRET).update(`csrf:${sessionToken}`).digest("base64url");
}

export async function csrfGuard(request: FastifyRequest): Promise<void> {
  if (SAFE.has(request.method)) return;
  if (!request.url.startsWith("/api/admin")) return;
  // sessão anexada pelo authMiddleware (onRequest/preHandler anterior)
  const session = (request as any).session as { id?: string } | undefined;
  const cookies = (request as any).cookies;
  const hasSessionCookie = !!cookies?.aa_session;
  if (!session?.id && !hasSessionCookie) return; // sem sessão, auth barra
  const header = request.headers["x-csrf-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided) throw forbidden("Token CSRF ausente");
  const candidates: string[] = [];
  if (session?.id) candidates.push(csrfTokenForSession(session.id));
  if (cookies?.aa_session) candidates.push(csrfTokenFor(String(cookies.aa_session)));
  const ok = candidates.some((expected) => {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) throw forbidden("Token CSRF inválido");
}

