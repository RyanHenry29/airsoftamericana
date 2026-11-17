// language: TS, file: apps/api/src/db/migration-concurrency.test.ts, target: PostgreSQL real
// AUD-03: teste de concorrência REAL entre sessões PostgreSQL independentes.
// Duas pools de conexão separadas, cada uma com sua conexão física,
// tentam executar o mesmo passo de migração. O advisory lock deve serializar.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, closeDb, setDb } from "./index.js";
import type { Db } from "./index.js";
import { runMigrationSteps, computeStepChecksum } from "./migration-ledger.js";

let db: Db;
let pgInstance: { client: any; release: () => Promise<void> } | null = null;

beforeAll(async () => {
  // Abre conexão dedicada para setup/teardown
  db = await getDb();
  setDb(db);
  
  // Cria passo sintético para o teste de concorrência
  const step = {
    name: "test_concurrency_multi_process_001",
    description: "passo sintético para teste multi-processo",
    statements: [
      `CREATE TABLE IF NOT EXISTS "concurrency_scratch" ("id" text PRIMARY KEY, "n" integer NOT NULL);`,
      `INSERT INTO "concurrency_scratch" ("id", "n") VALUES ('concurrent', 0) ON CONFLICT ("id") DO NOTHING;`,
      `UPDATE "concurrency_scratch" SET "n" = "n" + 1 WHERE "id" = 'concurrent';`,
    ],
    nonIdempotent: false,
  };
  
  // Limpa estado anterior
  await db.execute(sql`DROP TABLE IF EXISTS "concurrency_scratch"`);
  await db.execute(sql`DELETE FROM "migration_ledger" WHERE "step_name" = ${step.name}`);
});

afterAll(async () => {
  // Limpeza final
  await db.execute(sql`DROP TABLE IF EXISTS "concurrency_scratch"`);
  await db.execute(sql`DELETE FROM "migration_ledger" WHERE "step_name" = 'test_concurrency_multi_process_001'`);
  await closeDb();
});

describe("AUD-03: concorrência real entre pools PostgreSQL independentes", () => {
  // Este teste SÓ roda no pg-integration (PostgreSQL real)
  // Pula no ambiente PGlite local onde advisory lock não é suportado
  if (process.env.DATABASE_URL?.startsWith("postgresql://")) {
    it("duas pools independentes serializam via advisory lock — exatamente-uma execução", async () => {
      const step = {
        name: "test_concurrency_multi_process_001",
        description: "passo sintético para teste multi-processo",
        statements: [
          `CREATE TABLE IF NOT EXISTS "concurrency_scratch" ("id" text PRIMARY KEY, "n" integer NOT NULL);`,
          `INSERT INTO "concurrency_scratch" ("id", "n") VALUES ('concurrent', 0) ON CONFLICT ("id") DO NOTHING;`,
          `UPDATE "concurrency_scratch" SET "n" = "n" + 1 WHERE "id" = 'concurrent';`,
        ],
        nonIdempotent: false,
      };

      // Cria DOIS pools PostgreSQL independentes (simulando duas instâncias de aplicação)
      const { Pool } = await import("pg");
      const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
      const { schema } = await import("./index.js");
      
      const pgConfig = {
        host: "localhost",
        port: 55432,
        user: "postgres",
        password: "integration",
        database: "postgres",
        max: 1,
      };
      
      const pool1 = new Pool(pgConfig);
      const pool2 = new Pool(pgConfig);
      
      const db1 = drizzlePg(pool1, { schema });
      const db2 = drizzlePg(pool2, { schema });
      
      try {
        // Executa AMBOS em paralelo - o advisory lock deve serializar
        const [summary1, summary2] = await Promise.all([
          runMigrationSteps(db1, [step]),
          runMigrationSteps(db2, [step]),
        ]);

        // Exatamente um aplicou, o outro pulou
        const totalApplied = summary1.applied.length + summary2.applied.length;
        const totalSkipped = summary1.skipped.length + summary2.skipped.length;
        
        expect(totalApplied).toBe(1);
        expect(totalSkipped).toBe(1);

        // Verifica contador no banco (exatamente 1) - usa pool1 para verificação
        const scratchResult = await pool1.query(`SELECT "n" FROM "concurrency_scratch" WHERE "id" = 'concurrent'`);
        expect(scratchResult.rows[0]?.n).toBe(1);

        // Ledger tem exatamente 1 registro aplicada
        const ledgerResult = await pool1.query(`SELECT "status", "checksum" FROM "migration_ledger" WHERE "step_name" = 'test_concurrency_multi_process_001'`);
        expect(ledgerResult.rows.length).toBe(1);
        expect(ledgerResult.rows[0].status).toBe("aplicada");
      } finally {
        await pool1.end();
        await pool2.end();
      }
    }, 120000);
  } else {
    it.skip("concorrência multi-processo (só roda no pg-integration com PostgreSQL)", () => {
      // Pula no ambiente PGlite
    });
  }
});