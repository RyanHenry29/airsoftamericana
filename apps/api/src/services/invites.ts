// language: TS, file: apps/api/src/services/invites.ts, target: Fastify 5
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { randomToken, sha256, hashPassword } from "../lib/crypto.js";
import { ROLES, type Role } from "../lib/rbac.js";

const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export interface CreatedInvite {
  id: string;
  token: string; // cru — mostrar uma vez; nunca persistir
  expiresAt: Date;
}

export async function createInvite(
  db: Db,
  input: { email: string; role: Role; createdBy: string },
): Promise<CreatedInvite> {
  if (!ROLES.includes(input.role)) throw Object.assign(new Error("Papel inválido"), { status: 400, code: "invalid_role" });
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await db
    .insert(schema.adminInvites)
    .values({
      email: input.email.trim().toLowerCase(),
      role: input.role,
      tokenHash,
      expiresAt,
      createdBy: input.createdBy,
    })
    .returning();
  return { id: row!.id, token, expiresAt };
}

export async function listInvites(db: Db) {
  const rows = await db
    .select({
      id: schema.adminInvites.id,
      email: schema.adminInvites.email,
      role: schema.adminInvites.role,
      expiresAt: schema.adminInvites.expiresAt,
      usedAt: schema.adminInvites.usedAt,
      createdAt: schema.adminInvites.createdAt,
      createdBy: schema.adminInvites.createdBy,
    })
    .from(schema.adminInvites)
    .orderBy(desc(schema.adminInvites.createdAt));
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    status: r.usedAt ? "used" : r.expiresAt <= now ? "expired" : "active",
  }));
}

export async function revokeInvite(db: Db, inviteId: string): Promise<boolean> {
  const res = await db
    .delete(schema.adminInvites)
    .where(and(eq(schema.adminInvites.id, inviteId), isNull(schema.adminInvites.usedAt)))
    .returning();
  return res.length > 0;
}

export async function acceptInvite(
  db: Db,
  input: { token: string; password: string; name?: string },
): Promise<{ userId: string; email: string }> {
  const tokenHash = sha256(input.token);
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.adminInvites)
    .where(eq(schema.adminInvites.tokenHash, tokenHash));
  const invite = rows[0];
  if (!invite) {
    throw Object.assign(new Error("Convite inválido."), { status: 400, code: "invite_invalid" });
  }
  if (invite.usedAt) {
    throw Object.assign(new Error("Este convite já foi utilizado."), { status: 400, code: "invite_used" });
  }
  if (invite.expiresAt <= now) {
    throw Object.assign(new Error("Este convite expirou."), { status: 400, code: "invite_expired" });
  }

  const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, invite.email)).limit(1);
  if (existing[0]) throw Object.assign(new Error("Já existe uma conta com este e-mail."), { status: 409, code: "email_taken" });

  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: invite.email,
      passwordHash,
      name: input.name?.trim() || invite.email.split("@")[0] || "Usuário",
      role: invite.role,
      active: true,
      mfaEnabled: false, // obrigado a configurar MFA (gate)
    })
    .returning();

  // marca uso único (condicional evita corrida/reutilização)
  const used = await db
    .update(schema.adminInvites)
    .set({ usedAt: now })
    .where(and(eq(schema.adminInvites.id, invite.id), isNull(schema.adminInvites.usedAt)))
    .returning();
  if (!used.length) {
    throw Object.assign(new Error("Este convite já foi utilizado."), { status: 400, code: "invite_used" });
  }

  return { userId: user!.id, email: invite.email };
}
