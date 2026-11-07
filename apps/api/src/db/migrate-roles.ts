// language: TS, file: apps/api/src/db/migrate-roles.ts, target: Postgres/PGlite
import { sql } from "drizzle-orm";
import type { Db } from "./index.js";

/**
 * B.8 — Mapeamento de papéis legados → 7 papéis novos.
 *
 * | legado   | novo (cobertura)     | nota                                      |
 * |----------|----------------------|-------------------------------------------|
 * | admin    | superadmin*          | *somente o 1º usuário (created_at); demais → gerente |
 * | manager  | gerente              |                                           |
 * | operator | atendimento          | menor papel que cobria operação diária    |
 * | viewer   | somente-leitura      |                                           |
 *
 * Idempotente: marca conclusão em system_settings['role_migration_b8_done'].
 * Reversível (manual): UPDATE users SET role = CASE role
 *   WHEN 'superadmin' THEN 'admin' WHEN 'gerente' THEN 'manager'
 *   WHEN 'atendimento' THEN 'operator' WHEN 'somente-leitura' THEN 'viewer'
 *   ELSE role END; DELETE FROM system_settings WHERE key='role_migration_b8_done';
 * (a reversão não restaura o enum original — manter coluna varchar).
 */
export async function migrateLegacyRoles(db: Db): Promise<{ migrated: number; firstSuperadmin: string | null }> {
  // guarda de idempotência
  try {
    const done = await db.execute(sql`SELECT value FROM "system_settings" WHERE key = 'role_migration_b8_done' LIMIT 1`);
    const rows = (done as any).rows ?? done;
    if (Array.isArray(rows) && rows.length > 0) return { migrated: 0, firstSuperadmin: null };
  } catch { /* tabela pode não existir em contexto mínimo; prossegue */ }

  const legacy = ["admin", "manager", "operator", "viewer"];
  const res = await db.execute(sql`SELECT id, role, created_at FROM "users" ORDER BY created_at ASC, id ASC`);
  const users = ((res as any).rows ?? res) as Array<{ id: string; role: string; created_at: string | Date }>;
  if (users.length === 0) return { migrated: 0, firstSuperadmin: null };

  let migrated = 0;
  let firstSuperadmin: string | null = null;
  for (let i = 0; i < users.length; i++) {
    const u = users[i]!;
    const isLegacy = legacy.includes(u.role);
    if (i === 0) {
      // Só o primeiro usuário vira superadmin
      if (u.role !== "superadmin") {
        await db.execute(sql`UPDATE "users" SET role = 'superadmin', needs_role_review = false WHERE id = ${u.id}::uuid`);
        migrated++;
      }
      firstSuperadmin = u.id;
      continue;
    }
    if (!isLegacy) continue; // já está nos 7 papéis novos
    let target = "atendimento";
    if (u.role === "admin") target = "gerente"; // demais admins NÃO viram superadmin
    else if (u.role === "manager") target = "gerente";
    else if (u.role === "operator") target = "atendimento";
    else if (u.role === "viewer") target = "somente-leitura";
    await db.execute(sql`UPDATE "users" SET role = ${target}, needs_role_review = true WHERE id = ${u.id}::uuid`);
    migrated++;
  }

  try {
    await db.execute(sql`
      INSERT INTO "system_settings" ("key","value","updated_at")
      VALUES ('role_migration_b8_done', ${JSON.stringify({ at: new Date().toISOString(), migrated })}::jsonb, now())
      ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `);
  } catch { /* best-effort marker */ }

  return { migrated, firstSuperadmin };
}
