// language: TS, file: apps/api/src/cli/e2e-seed.ts, target: Node CLI (E2E seed)
// Semeia dados de teste ISOLADOS para Playwright. Use PGLITE_DIR dedicado.
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword, decryptSecret } from "../lib/crypto.js";
import { generateTotpSetup, replaceRecoveryCodes } from "../services/mfa.js";
import { createInvite } from "../services/invites.js";

async function main() {
  const db = await getDb();
  await migrate(db);
  const pass = await hashPassword("Senha123!");

  // superadmin com MFA ativo (TOTP conhecido)
  const totp = generateTotpSetup("admin-mfa@e2e.local");
  const [mfaAdmin] = await db.insert(schema.users).values({
    email: "admin-mfa@e2e.local", passwordHash: pass, name: "Admin MFA E2E", role: "superadmin",
    active: true, mfaEnabled: true, totpSecret: totp.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email }).returning();
  const mfaAdminId = mfaAdmin?.id || (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "admin-mfa@e2e.local")).limit(1))[0]!.id;
  const recovery = await replaceRecoveryCodes(db, mfaAdminId);

  // operador atendimento com MFA ativo
  const totpAt = generateTotpSetup("operador-atendimento@e2e.local");
  const [at] = await db.insert(schema.users).values({
    email: "operador-atendimento@e2e.local", passwordHash: pass, name: "Atendimento E2E", role: "atendimento",
    active: true, mfaEnabled: true, totpSecret: totpAt.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email }).returning();
  const atId = at?.id || (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "operador-atendimento@e2e.local")).limit(1))[0]!.id;
  await replaceRecoveryCodes(db, atId);

  // admin sem MFA (para fluxo de setup)
  const setupTotp = generateTotpSetup("admin-sem-mfa@e2e.local");
  await db.insert(schema.users).values({
    email: "admin-sem-mfa@e2e.local", passwordHash: pass, name: "Admin Sem MFA E2E", role: "superadmin",
    active: true, mfaEnabled: false, totpSecret: setupTotp.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email });

  // convites
  const inv = await createInvite(db, { email: `convidado-${Date.now()}@e2e.local`, role: "atendimento", createdBy: mfaAdminId });
  const invExp = await createInvite(db, { email: `expirado-${Date.now()}@e2e.local`, role: "atendimento", createdBy: mfaAdminId });
  await db.update(schema.adminInvites).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.adminInvites.id, invExp.id));

  // imprime APENAS identificadores/tokens de convite e secrets de TOTP de TESTE (ambiente isolado E2E)
  // — necessário para os testes determinísticos; não usar em produção.
  console.log(JSON.stringify({
    E2E_READY: "1",
    E2E_TOTP_SECRET: totp.secretBase32,
    E2E_TOTP_SECRET_AT: totpAt.secretBase32,
    E2E_TOTP_SETUP_SECRET: setupTotp.secretBase32,
    E2E_RECOVERY_CODE: recovery[0],
    E2E_INVITE_TOKEN: inv.token,
    E2E_INVITE_EXPIRED_TOKEN: invExp.token,
  }, null, 2));

  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
