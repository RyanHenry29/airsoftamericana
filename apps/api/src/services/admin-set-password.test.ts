// language: TS, file: apps/api/src/services/admin-set-password.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword, verifyPasswordDetailed } from "../lib/crypto.js";
import { createSession, listActiveSessions } from "./sessions.js";
import { setAdminPassword } from "./admin-set-password.js";

let db: any;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

async function mkUser(email: string) {
  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: await hashPassword("SenhaAntiga123!"),
      name: "Set Password",
      role: "superadmin",
      active: true,
    })
    .returning();
  return u;
}

describe("admin:set-password (serviço)", () => {
  it("troca a senha, revoga sessões e limpa o lockout da conta", async () => {
    const email = `setpw-${Date.now()}@test.local`;
    const u = await mkUser(email);
    await createSession(db, { userId: u.id, mfaVerified: true });
    await createSession(db, { userId: u.id, mfaVerified: true });
    await db.insert(schema.authLockouts).values({
      key: `acct:${email}`,
      failCount: 5,
      lockedUntil: new Date(Date.now() + 60 * 60 * 1000),
    });

    const r = await setAdminPassword(db, email, "Admin123!", { actorLabel: "test:set-password" });
    expect(r.email).toBe(email);
    expect(r.sessionsRevoked).toBeGreaterThanOrEqual(2);
    expect(r.lockoutsCleared).toBeGreaterThanOrEqual(1);

    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    const old = await verifyPasswordDetailed("SenhaAntiga123!", after.passwordHash);
    expect(old.ok).toBe(false);
    const fresh = await verifyPasswordDetailed("Admin123!", after.passwordHash);
    expect(fresh.ok).toBe(true);

    const active = await listActiveSessions(db, u.id);
    expect(active).toHaveLength(0);

    const rows = await db
      .select()
      .from(schema.authLockouts)
      .where(eq(schema.authLockouts.key, `acct:${email}`));
    expect(rows).toHaveLength(0);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, u.id));
    expect(audits.some((a: any) => a.action === "admin.password_reset")).toBe(true);
  });

  it("com resetMfa, o próximo login obriga novo segundo fator", async () => {
    const email = `setpw-mfa-${Date.now()}@test.local`;
    const [u] = await db
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword("SenhaAntiga123!"),
        name: "Set Password MFA",
        role: "superadmin",
        active: true,
        mfaEnabled: true,
        totpSecret: "encrypted-not-real-for-test",
      })
      .returning();

    const r = await setAdminPassword(db, email, "Admin123!", { resetMfa: true, actorLabel: "test" });
    expect(r.mfaReset).toBe(true);

    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    expect(after.mfaEnabled).toBe(false);
    expect(after.totpSecret).toBeNull();
    const fresh = await verifyPasswordDetailed("Admin123!", after.passwordHash);
    expect(fresh.ok).toBe(true);
  });

  it("recusa usuário inexistente e senha curta", async () => {
    await expect(setAdminPassword(db, `naoexiste-${Date.now()}@test.local`, "Admin123!")).rejects.toMatchObject({
      code: "not_found",
    });
    const email = `short-${Date.now()}@test.local`;
    await mkUser(email);
    await expect(setAdminPassword(db, email, "curta")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setAdminPassword(db, email, "")).rejects.toMatchObject({ code: "invalid_input" });
  });
});
