// language: TS, file: apps/api/src/cli/e2e-seed.ts, target: Node CLI (E2E seed)
// Semeia dados de teste ISOLADOS para Playwright. Use PGLITE_DIR dedicado.
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword, decryptSecret } from "../lib/crypto.js";
import { generateTotpSetup, replaceRecoveryCodes } from "../services/mfa.js";
import { createInvite } from "../services/invites.js";
import { randomUUID } from "node:crypto";

async function main() {
  const db = await getDb();
  await migrate(db);
  const pass = await hashPassword("Senha123!");

  // superadmin com MFA ativo (TOTP conhecido) — usado por convites; testes TOTP usam usuários dedicados (evita replay guard)
  const totp = generateTotpSetup("admin-mfa@e2e.local");
  const [mfaAdmin] = await db.insert(schema.users).values({
    email: "admin-mfa@e2e.local", passwordHash: pass, name: "Admin MFA E2E", role: "superadmin",
    active: true, mfaEnabled: true, totpSecret: totp.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email }).returning();
  const mfaAdminId = mfaAdmin?.id || (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "admin-mfa@e2e.local")).limit(1))[0]!.id;
  await replaceRecoveryCodes(db, mfaAdminId);

  // usuários dedicados por fluxo (mesmo secret TOTP para determinismo; IDs distintos evitam replay entre testes)
  for (const email of ["admin-mfa-logout@e2e.local", "admin-mfa-verify@e2e.local", "admin-mfa-passkey@e2e.local", "admin-mfa-sessions@e2e.local"]) {
    await db.insert(schema.users).values({
      email, passwordHash: pass, name: `E2E ${email}`, role: "superadmin",
      active: true, mfaEnabled: true, totpSecret: totp.encryptedSecret,
    }).onConflictDoNothing({ target: schema.users.email });
  }

  // operador atendimento com MFA ativo
  const totpAt = generateTotpSetup("operador-atendimento@e2e.local");
  const [at] = await db.insert(schema.users).values({
    email: "operador-atendimento@e2e.local", passwordHash: pass, name: "Atendimento E2E", role: "atendimento",
    active: true, mfaEnabled: true, totpSecret: totpAt.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email }).returning();
  const atId = at?.id || (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "operador-atendimento@e2e.local")).limit(1))[0]!.id;
  await replaceRecoveryCodes(db, atId);

  // usuários dedicados aos testes de import CSV (evita replay/lockout entre specs)
  const totpCsv1 = generateTotpSetup("admin-mfa-csv1@e2e.local");
  await db.insert(schema.users).values({
    email: "admin-mfa-csv1@e2e.local", passwordHash: pass, name: "Admin CSV1 E2E", role: "superadmin",
    active: true, mfaEnabled: true, totpSecret: totpCsv1.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email });
  const totpCsv2 = generateTotpSetup("admin-mfa-csv2@e2e.local");
  await db.insert(schema.users).values({
    email: "admin-mfa-csv2@e2e.local", passwordHash: pass, name: "Admin CSV2 E2E", role: "superadmin",
    active: true, mfaEnabled: true, totpSecret: totpCsv2.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email });
  const totpMkt = generateTotpSetup("admin-mfa-marketing@e2e.local");
  await db.insert(schema.users).values({
    email: "admin-mfa-marketing@e2e.local", passwordHash: pass, name: "Marketing E2E", role: "marketing",
    active: true, mfaEnabled: true, totpSecret: totpMkt.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email });
  const totpCatAdm = generateTotpSetup("admin-mfa-catalog@e2e.local");
  await db.insert(schema.users).values({
    email: "admin-mfa-catalog@e2e.local", passwordHash: pass, name: "Admin Catalog E2E", role: "superadmin",
    active: true, mfaEnabled: true, totpSecret: totpCatAdm.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email });
  const totpAtCat = generateTotpSetup("operador-atendimento-catalog@e2e.local");
  await db.insert(schema.users).values({
    email: "operador-atendimento-catalog@e2e.local", passwordHash: pass, name: "Atendimento Catalog E2E", role: "atendimento",
    active: true, mfaEnabled: true, totpSecret: totpAtCat.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email });
  const totpAtImport = generateTotpSetup("operador-atendimento-import@e2e.local");
  const [atImp] = await db.insert(schema.users).values({
    email: "operador-atendimento-import@e2e.local", passwordHash: pass, name: "Atendimento Import E2E", role: "atendimento",
    active: true, mfaEnabled: true, totpSecret: totpAtImport.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email }).returning();
  const atImpId = atImp?.id || (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "operador-atendimento-import@e2e.local")).limit(1))[0]!.id;
  await replaceRecoveryCodes(db, atImpId);

  // admin sem MFA (para fluxo de setup)
  const setupTotp = generateTotpSetup("admin-sem-mfa@e2e.local");
  await db.insert(schema.users).values({
    email: "admin-sem-mfa@e2e.local", passwordHash: pass, name: "Admin Sem MFA E2E", role: "superadmin",
    active: true, mfaEnabled: false, totpSecret: setupTotp.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email });

  // usuário dedicado ao teste de recovery (uso único)
  const totpRec = generateTotpSetup("admin-recovery@e2e.local");
  const [recUser] = await db.insert(schema.users).values({
    email: "admin-recovery@e2e.local", passwordHash: pass, name: "Admin Recovery E2E", role: "superadmin",
    active: true, mfaEnabled: true, totpSecret: totpRec.encryptedSecret,
  }).onConflictDoNothing({ target: schema.users.email }).returning();
  const recId = recUser?.id || (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, "admin-recovery@e2e.local")).limit(1))[0]!.id;
  const recoveryRec = await replaceRecoveryCodes(db, recId);

  // convites
  const inv = await createInvite(db, { email: `convidado-${Date.now()}@e2e.local`, role: "atendimento", createdBy: mfaAdminId });
  const invExp = await createInvite(db, { email: `expirado-${Date.now()}@e2e.local`, role: "atendimento", createdBy: mfaAdminId });
  await db.update(schema.adminInvites).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.adminInvites.id, invExp.id));

  // DEMO catálogo (FASE 3 E2E) — dados próprios marcados DEMO
  await db.insert(schema.categories).values({ name: "[DEMO] E2E Categoria", slug: "demo-e2e-cat", description: "", ageRestricted: false, active: true, position: 0 } as any).onConflictDoNothing({ target: schema.categories.slug } as any);
  await db.insert(schema.brands).values({ name: "[DEMO] E2E Marca", slug: "demo-e2e-brand", description: "", active: true, position: 0 } as any).onConflictDoNothing({ target: schema.brands.slug } as any);
  const [ecat] = await db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.slug, "demo-e2e-cat")).limit(1);
  const [ebrand] = await db.select({ id: schema.brands.id }).from(schema.brands).where(eq(schema.brands.slug, "demo-e2e-brand")).limit(1);
  if (ecat && ebrand) {
    const pid = randomUUID(), vid = randomUUID();
    await db.insert(schema.products).values({ id: pid, name: "[DEMO] E2E Produto", slug: "demo-e2e-produto", shortDescription: "DEMO", description: "Produto DEMO para E2E.", categoryId: ecat.id, brandId: ebrand.id, ageRestricted: false, featured: true, published: true, condicao: "novo" } as any).onConflictDoNothing({ target: schema.products.slug } as any);
    await db.insert(schema.productVariants).values({ id: vid, productId: pid, sku: "DEMO-E2E-SKU-001", name: "Padrao", priceCents: 19900, active: true, weightGrams: 500 } as any).onConflictDoNothing({ target: schema.productVariants.sku } as any);
    await db.insert(schema.inventory).values({ variantId: vid, physical: 10, reserved: 0, minQuantity: 2 } as any).onConflictDoNothing({ target: schema.inventory.variantId } as any);
  }

  // imprime APENAS identificadores/tokens de convite e secrets de TOTP de TESTE (ambiente isolado E2E)
  // — necessário para os testes determinísticos; não usar em produção.
  console.log(JSON.stringify({
    E2E_READY: "1",
    E2E_TOTP_SECRET: totp.secretBase32,
    E2E_TOTP_SECRET_AT: totpAt.secretBase32,
    E2E_TOTP_SECRET_AT_IMPORT: totpAtImport.secretBase32,
    E2E_TOTP_SECRET_CSV1: totpCsv1.secretBase32,
    E2E_TOTP_SECRET_CSV2: totpCsv2.secretBase32,
    E2E_TOTP_SECRET_MARKETING: totpMkt.secretBase32,
    E2E_TOTP_SECRET_CATALOG: totpCatAdm.secretBase32,
    E2E_TOTP_SECRET_AT_CATALOG: totpAtCat.secretBase32,
    E2E_TOTP_SECRET_RECOVERY: totpRec.secretBase32,
    E2E_RECOVERY_USER: "admin-recovery@e2e.local",
    E2E_RECOVERY_CODE: recoveryRec[0],
    E2E_INVITE_TOKEN: inv.token,
    E2E_INVITE_EXPIRED_TOKEN: invExp.token,
    E2E_CATEGORY_SLUG: "demo-e2e-cat",
    E2E_BRAND_SLUG: "demo-e2e-brand",
  }, null, 2));

  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
