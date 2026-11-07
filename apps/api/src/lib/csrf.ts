// language: TS, file: apps/api/src/lib/csrf.ts, target: Fastify 5
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { forbidden } from "./errors.js";
import { config } from "../config.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Token CSRF derivado do valor do cookie de sessão.
 *
 * O cookie é o segredo da sessão (256 bits, HttpOnly): o HMAC dele é o token
 * que o painel envia no cabeçalho. A mesma função gera e confere — outra
 * fonte de verdade (id da sessão, por exemplo) produz um token que a guarda
 * não reconhece e derruba toda mutação do painel.
 */
export function csrfTokenFor(sessionToken: string): string {
  return crypto
    .createHmac("sha256", config.JWT_SECRET)
    .update(`csrf:${sessionToken}`)
    .digest("base64url");
}

/** Legado: derivado do id da sessão (mantido para compatibilidade). */
export function csrfTokenForSession(sessionId: string): string {
  return crypto
    .createHmac("sha256", config.JWT_SECRET)
    .update(`csrf:sid:${sessionId}`)
    .digest("base64url");
}

export async function csrfGuard(request: FastifyRequest): Promise<void> {
  if (SAFE.has(request.method)) return;
  if (!request.url.startsWith("/api/admin")) return;
  const cookies = (request as any).cookies;
  const raw = cookies?.aa_session ? String(cookies.aa_session) : "";
  const session = (request as any).session as { id?: string } | undefined;
  // Sem cookie/sessão — a autorização barra a requisição.
  if (!raw && !session?.id) return;
  const header = request.headers["x-csrf-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided) throw forbidden("Token CSRF ausente");
  // Aceita token derivado do cookie (raw) ou do id da sessão — ambos vinculados à sessão.
  const candidates: string[] = [];
  if (raw) candidates.push(csrfTokenFor(raw));
  if (session?.id) candidates.push(csrfTokenForSession(session.id));
  const a = Buffer.from(provided);
  const ok = candidates.some((expected) => {
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) throw forbidden("Token CSRF inválido");
}
