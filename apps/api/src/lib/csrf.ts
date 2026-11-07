// language: TS, file: apps/api/src/lib/csrf.ts, target: Fastify 5
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { forbidden } from "./errors.js";
import { config } from "../config.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Token derivado do segredo da sessão — stateless, verificável sem DB. */
export function csrfTokenFor(sessionToken: string): string {
  return crypto.createHmac("sha256", config.JWT_SECRET).update(`csrf:${sessionToken}`).digest("base64url");
}

function sessionTokenOf(request: FastifyRequest): string | undefined {
  const cookies = (request as any).cookies;
  if (cookies?.aa_session) return String(cookies.aa_session);
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}

export async function csrfGuard(request: FastifyRequest): Promise<void> {
  if (SAFE.has(request.method)) return;
  if (!request.url.startsWith("/api/admin")) return;
  const session = sessionTokenOf(request);
  // Sem sessão autenticada o auth guard barra; CSRF só faz sentido com sessão.
  if (!session) return;
  const header = request.headers["x-csrf-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  const expected = csrfTokenFor(session);
  if (!provided) throw forbidden("Token CSRF ausente");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw forbidden("Token CSRF inválido");
}
