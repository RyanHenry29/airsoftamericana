// language: TS, file: apps/api/src/services/admin-reset-mfa.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword, sha256 } from "../lib/crypto.js";
import { createSession, listActiveSessions } from "./sessions.js";
import { replaceRecoveryCodes } from "./mfa.js";
import { resetMfaForEmail } from "./admin-reset-mfa.js";

let db: any;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

describe("admin:reset-mfa (serviço)", () => {
  it("remove estado MFA, apaga recovery/passkeys e invalida sessões", async () => {
    const email = `reset-${Date.now()}@test.local`;
    const [u] = await db
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword("Senha123!"),
        name: "Reset MFA",
        role: "atendimento",
        active: true,
        mfaEnabled: true,
        totpSecret: "encrypted-not-real-for-test",
      })
      .returning();
    await replaceRecoveryCodes(db, u.id);
    await db.insert(schema.webauthnCredentials).values({
      userId: u.id,
      credentialId: `cred-${Date.now()}`,
      publicKey: "cHVia2V5",
      counter: 0,
      label: "Passkey",
    });
    await createSession(db, { userId: u.id, mfaVerified: true });
    await createSession(db, { userId: u.id, mfaVerified: true });

    const result = await resetMfaForEmail(db, email, "test:reset");
    expect(result.email).toBe(email);
    expect(result.sessionsRevoked).toBeGreaterThanOrEqual(2);

    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    expect(after.mfaEnabled).toBe(false);
    expect(after.totpSecret).toBeNull();
    expect(after.totpLastUsedStep).toBeNull();

    const codes = await db.select().from(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, u.id));
    expect(codes).toHaveLength(0);
    const creds = await db.select().from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, u.id));
    expect(creds).toHaveLength(0);
    const active = await listActiveSessions(db, u.id);
    expect(active).toHaveLength(0);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, u.id));
    expect(audits.some((a: any) => a.action === "mfa.emergency_reset")).toBe(true);
  });

  it("retorna erro seguro se o usuário não existir", async () => {
    await expect(resetMfaForEmail(db, `naoexiste-${Date.now()}@test.local`)).rejects.toMatchObject({
      code: "not_found",
      message: "Usuário não encontrado.",
    });
  });
});
