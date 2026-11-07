import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { unauthorized, forbidden } from "../lib/errors.js";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface JwtPayload {
  sub: string;
  role: string;
  type: "access" | "customer";
}

// Convert jwtVerify result to JwtPayload - use unknown as intermediary
function toJwtPayload(payload: unknown): JwtPayload {
  const p = payload as { sub?: string; role?: string; type?: string };
  return {
    sub: p.sub || "",
    role: p.role || "operator",
    type: p.type || "access",
  } as JwtPayload;
}

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

// Extract token from request (cookie or header)
function getTokenFromRequest(request: FastifyRequest): string | undefined {
  // Try cookies plugin
  try {
    const cookies = (request as any).cookies;
    if (cookies && cookies["aa_session"]) {
      return String(cookies["aa_session"]);
    }
  } catch {}

  // Try authorization header
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  return undefined;
}

export async function authMiddleware(request: FastifyRequest): Promise<void> {
  const token = getTokenFromRequest(request);
  if (!token) throw unauthorized();

  try {
    const payload = await verifyJwt(token);
    (request as any).user = payload;
  } catch {
    throw unauthorized("Token inválido ou expirado");
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
  const token = getTokenFromRequest(request);
  if (!token) return; // guest access allowed

  try {
    const payload = await verifyJwt(token);
    if (payload.type === "customer") {
      (request as any).customer = { id: payload.sub };
    }
  } catch {
    // token inválido = guest
  }
}

export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/api/admin")) {
      await authMiddleware(req as any);
    } else if (req.url.startsWith("/api/auth/me")) {
      await customerAuthMiddleware(req as any);
    }
  });
}