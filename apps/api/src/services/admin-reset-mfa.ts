// language: TS, file: apps/api/src/services/admin-reset-mfa.ts, target: Node CLI/service
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { revokeAllUserSessions } from "./sessions.js";
import { audit } from "../lib/audit.js";

export interface ResetMfaResult {
  userId: string;
  email: string;
  sessionsRevoked: number;
}

/**
 * Reset emergencial de MFA (operação administrativa auditada).
 * - invalida todas as sessões
 * - remove estado MFA (TOTP, recovery, passkeys)
 * - obriga nova configuração no próximo login
 * Nunca imprime/retorna segredos.
 */
export async function resetMfaForEmail(
  db: Db,
  emailRaw: string,
  actorLabel = "cli:admin-reset-mfa",
): Promise<ResetMfaResult> {
  const email = String(emailRaw ?? "").trim().toLowerCase();
  if (!email) {
    throw Object.assign(new Error("E-mail não informado."), { code: "invalid_input" });
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) {
    // erro seguro (não vaza detalhes além do necessário para o operador autorizado)
    throw Object.assign(new Error("Usuário não encontrado."), { code: "not_found" });
  }

  const sessionsRevoked = await revokeAllUserSessions(db, user.id);
  await db.delete(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, user.id));
  await db.delete(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, user.id));
  await db
    .update(schema.users)
    .set({ mfaEnabled: false, totpSecret: null, totpLastUsedStep: null })
    .where(eq(schema.users.id, user.id));

  await audit(db, {
    actorLabel,
    action: "mfa.emergency_reset",
    entity: "users",
    entityId: user.id,
    after: { mfaEnabled: false, sessionsRevoked },
  });

  return { userId: user.id, email: user.email, sessionsRevoked };
}
