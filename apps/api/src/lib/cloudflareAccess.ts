// language: TS, file: apps/api/src/lib/cloudflareAccess.ts, target: Fastify 5
import type { FastifyRequest, FastifyReply } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";

export function cfAccessEnabled(): boolean {
  return !!(config.CF_ACCESS_TEAM_DOMAIN && config.CF_ACCESS_AUD);
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

/** Verifica Cf-Access-Jwt-Assertion. Lança em falha. */
export async function verifyCfAccess(token: string, teamDomain = config.CF_ACCESS_TEAM_DOMAIN, aud = config.CF_ACCESS_AUD): Promise<void> {
  const jwks = getJwks(teamDomain);
  await jwtVerify(token, jwks, { audience: aud, issuer: `https://${teamDomain}` });
}

/**
 * B.5: em produção, com opção ligada e header ausente/inválido → 404.
 * Fora de produção com opção ligada, exige header válido (403 em falha) para não quebrar dev silenciosamente.
 */
export async function cloudflareAccessGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.url.startsWith("/api/admin")) return;
  if (!cfAccessEnabled()) return;
  const header = request.headers["cf-access-jwt-assertion"];
  const token = Array.isArray(header) ? header[0] : header;
  const hide = config.NODE_ENV === "production";
  if (!token) {
    if (hide) return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
    return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
  }
  try {
    await verifyCfAccess(String(token));
  } catch {
    return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
  }
}
