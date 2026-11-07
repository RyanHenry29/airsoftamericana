// language: TS, file: apps/api/src/lib/audit.immutability.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";

let db: any;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

describe("B.6 — audit_logs imutável no banco", () => {
  it("UPDATE direto falha", async () => {
    // insere uma linha de auditoria
    await db.execute(sql`INSERT INTO "audit_logs" ("action","entity") VALUES ('test.immut','test')`);
    await expect(
      db.execute(sql`UPDATE "audit_logs" SET action = 'tampered' WHERE action = 'test.immut'`),
    ).rejects.toThrow();
  });

  it("DELETE direto falha", async () => {
    await expect(
      db.execute(sql`DELETE FROM "audit_logs" WHERE action = 'test.immut'`),
    ).rejects.toThrow();
  });
});
