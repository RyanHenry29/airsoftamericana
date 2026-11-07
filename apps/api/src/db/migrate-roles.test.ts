// language: TS, file: apps/api/src/db/migrate-roles.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { sql, asc } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "./migrate.js";
import { schema } from "./index.js";
import { hashPassword } from "../lib/crypto.js";
import { migrateLegacyRoles } from "./migrate-roles.js";

let db: any;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

describe("B.8 — mapeamento de papéis legados (banco povoado)", () => {
  it("1º usuário vira superadmin; demais mapeados com menor papel de cobertura e marcados revisão; idempotente", async () => {
    // limpa marcador e cria cenário legado
    await db.execute(sql`DELETE FROM "system_settings" WHERE key = 'role_migration_b8_done'`);
    // insere usuários com papéis legados (ids determinísticos por ordem)
    const pw = await hashPassword("Senha123!");
    // limpa usuários de teste anteriores deste cenário
    await db.execute(sql`DELETE FROM "users" WHERE email LIKE 'legacy-b8-%@t.local'`);
    await db.execute(sql`INSERT INTO "users" ("email","password_hash","name","role","active","created_at") VALUES
      ('legacy-b8-1@t.local', ${pw}, 'U1', 'admin', true, '2020-01-01T00:00:00Z'),
      ('legacy-b8-2@t.local', ${pw}, 'U2', 'admin', true, '2020-01-02T00:00:00Z'),
      ('legacy-b8-3@t.local', ${pw}, 'U3', 'manager', true, '2020-01-03T00:00:00Z'),
      ('legacy-b8-4@t.local', ${pw}, 'U4', 'operator', true, '2020-01-04T00:00:00Z'),
      ('legacy-b8-5@t.local', ${pw}, 'U5', 'viewer', true, '2020-01-05T00:00:00Z')`);

    const r = await migrateLegacyRoles(db);
    expect(r.migrated).toBeGreaterThan(0);

    const rows = await db.execute(sql`SELECT email, role, needs_role_review FROM "users" WHERE email LIKE 'legacy-b8-%@t.local' ORDER BY created_at ASC`);
    const list = (rows as any).rows ?? rows;
    const byEmail = Object.fromEntries(list.map((x: any) => [x.email, x]));
    expect(byEmail["legacy-b8-1@t.local"].role).toBe("superadmin");
    expect(byEmail["legacy-b8-1@t.local"].needs_role_review).toBe(false);
    expect(byEmail["legacy-b8-2@t.local"].role).toBe("gerente"); // admin não-primeiro
    expect(byEmail["legacy-b8-2@t.local"].needs_role_review).toBe(true);
    expect(byEmail["legacy-b8-3@t.local"].role).toBe("gerente");
    expect(byEmail["legacy-b8-4@t.local"].role).toBe("atendimento");
    expect(byEmail["legacy-b8-5@t.local"].role).toBe("somente-leitura");
    expect(byEmail["legacy-b8-5@t.local"].needs_role_review).toBe(true);

    // idempotente
    const r2 = await migrateLegacyRoles(db);
    expect(r2.migrated).toBe(0);
  });
});
