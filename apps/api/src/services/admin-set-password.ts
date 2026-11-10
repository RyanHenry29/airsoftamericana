// language: TS, file: apps/api/src/services/admin-set-password.ts, target: Node CLI/service
import { eq, like, or } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { revokeAllUserSessions } from "./sessions.js";
import { audit } from "../lib/audit.js";
import { resetMfaForEmail } from "./admin-reset-mfa.js";

export interface SetPasswordResult {
  userId: string;
  email: string;
  sessionsRevoked: number;
  lockoutsCleared: number;
  mfaReset: boolean;
}

/**
 * Definição emergencial de senha de operador (operação administrativa auditada).
 * - grava argon2id novo (nunca texto puro)
 * - invalida todas as sessões (a senha antiga deixa de valer em lugar nenhum)
 * - limpa o bloqueio da conta (`acct:<email>`) e dos IPs — as tentativas
 *   frustradas não podem manter o operador trancado fora depois do reset
 * - `resetMfa` opcional: remove TOTP/recovery/passkeys para o próximo login
 *   refazer o segundo fator do zero
 * Nunca imprime/retorna a senha.
 */
export async function setAdminPassword(
  db: Db,
  emailRaw: string,
  plain: string,
  opts: { resetMfa?: boolean; actorLabel?: string } = {},
): Promise<SetPasswordResult> {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  if (!email) {
    throw Object.assign(new Error("E-mail não informado."), { code: "invalid_input" });
  }
  if (String(plain ?? "").length < 8) {
    throw Object.assign(new Error("A senha precisa de pelo menos 8 caracteres."), { code: "invalid_input" });
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) {
    throw Object.assign(new Error("Usuário não encontrado."), { code: "not_found" });
  }

  const passwordHash = await hashPassword(plain);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));

  const sessionsRevoked = await revokeAllUserSessions(db, user.id);

  // `acct:<email>` é a chave do lockout; `ip:*` cobre o bloqueio por origem
  // (não dá para saber qual IP do operador — limpa todos, operador único).
  const cleared = await db
    .delete(schema.authLockouts)
    .where(
      or(
        eq(schema.authLockouts.key, `acct:${email}`),
        like(schema.authLockouts.key, "ip:%"),
        like(schema.authLockouts.key, `%${email}%`),
      ),
    );

  let mfaReset = false;
  if (opts.resetMfa) {
    await resetMfaForEmail(db, email, opts.actorLabel ?? "cli:admin-set-password");
    mfaReset = true;
  }

  const lockoutsCleared = (cleared as { rowCount?: number } | undefined)?.rowCount ?? 0;

  await audit(db, {
    actorLabel: opts.actorLabel ?? "cli:admin-set-password",
    action: "admin.password_reset",
    entity: "users",
    entityId: user.id,
    after: { sessionsRevoked, lockoutsCleared, mfaReset },
  });

  return { userId: user.id, email: user.email, sessionsRevoked, lockoutsCleared, mfaReset };
}
