// language: TS, file: apps/api/src/services/sessions.ts, target: Fastify 5
import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // 8h
export const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min
export const ADMIN_SESSION_COOKIE = "aa_session";

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // 256 bits
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface CreateSessionInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  mfaVerified?: boolean;
}

export interface CreatedSession {
  id: string;
  token: string; // cru — definir no cookie e descartar; nunca persistir
  expiresAt: Date;
  idleExpiresAt: Date;
}

export async function createSession(db: Db, input: CreateSessionInput): Promise<CreatedSession> {
  const now = new Date();
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  const inserted = await db
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      tokenHash,
      refreshTokenHash: tokenHash, // compat coluna legada NOT NULL em bases antigas
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
      idleExpiresAt,
      lastSeenAt: now,
      revokedAt: null,
      mfaVerifiedAt: input.mfaVerified ? now : null,
    })
    .returning();
  const row = inserted[0];
  return { id: row!.id, token, expiresAt, idleExpiresAt };
}

export interface ValidSession {
  session: typeof schema.sessions.$inferSelect;
  user: typeof schema.users.$inferSelect;
}

export async function validateSession(db: Db, token: string): Promise<ValidSession | null> {
  const tokenHash = hashToken(token);
  const now = new Date();
  const rows = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.tokenHash, tokenHash), isNull(schema.sessions.revokedAt)));
  const row = rows[0];
  if (!row) return null;
  if (!row.user.active) return null;
  if (row.session.expiresAt <= now) return null;
  const idle = row.session.idleExpiresAt;
  if (idle && idle <= now) return null;
  // rolagem da ociosidade (30 min)
  const nextIdle = new Date(now.getTime() + SESSION_IDLE_MS);
  const cappedIdle = nextIdle > row.session.expiresAt ? row.session.expiresAt : nextIdle;
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: now, idleExpiresAt: cappedIdle })
    .where(eq(schema.sessions.id, row.session.id));
  row.session.lastSeenAt = now;
  row.session.idleExpiresAt = cappedIdle;
  return row;
}

export async function rotateSession(
  db: Db,
  oldSessionId: string,
  input: CreateSessionInput & { mfaElevated?: boolean },
): Promise<CreatedSession> {
  // revoga a antiga e emite nova (rotação em login/elevação de privilégio)
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, oldSessionId));
  return createSession(db, { ...input, mfaVerified: input.mfaElevated ?? input.mfaVerified });
}

export async function revokeSession(db: Db, sessionId: string): Promise<boolean> {
  const res = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
    .returning();
  return res.length > 0;
}

export async function revokeAllUserSessions(db: Db, userId: string, exceptSessionId?: string): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, now)));
  let n = 0;
  for (const r of rows) {
    if (exceptSessionId && r.id === exceptSessionId) continue;
    await db.update(schema.sessions).set({ revokedAt: now }).where(eq(schema.sessions.id, r.id));
    n++;
  }
  return n;
}

export async function listActiveSessions(db: Db, userId: string) {
  const now = new Date();
  const rows = await db
    .select({
      id: schema.sessions.id,
      userAgent: schema.sessions.userAgent,
      ip: schema.sessions.ip,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      expiresAt: schema.sessions.expiresAt,
      idleExpiresAt: schema.sessions.idleExpiresAt,
      mfaVerifiedAt: schema.sessions.mfaVerifiedAt,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, now)));
  // filtra ociosas expiradas
  return rows.filter((r) => !r.idleExpiresAt || r.idleExpiresAt > now);
}

export function adminSessionCookieOptions(isProd: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: isProd,
    // cookie vive até o absolute; servidor também invalida
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  };
}
