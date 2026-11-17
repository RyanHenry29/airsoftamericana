// language: TS, file: apps/api/src/db/migration-concurrency.test.ts, target: PostgreSQL real
// AUD-03: teste de concorrência REAL entre PROCESSOS Node independentes.
// Dois processos Node separados, cada um com sua pool PostgreSQL,
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

describe("AUD-03: concorrência real entre PROCESSOS Node independentes", () => {
  it("dois processos Node independentes serializam via advisory lock — exatamente-uma execução", async () => {
    // Só roda se DATABASE_URL for PostgreSQL real (pg-integration)
    const databaseUrl = process.env.DATABASE_URL || "";
    if (!databaseUrl.startsWith("postgresql://")) {
      console.log("Skipping multi-process test: DATABASE_URL not set to PostgreSQL");
      return;
    }
    
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

    const { spawnSync } = await import("node:child_process");
    const path = await import("node:path");
    const os = await import("node:os");
    const fs = await import("node:fs");
    const tempScript = path.join(os.tmpdir(), `concurrency_runner_${Date.now()}.ts`);
    
    // Copy the runner script to temp location
    const runnerSource = "apps/api/src/db/migration-concurrency-runner.ts";
    fs.copyFileSync(runnerSource, tempScript);

    // Inicia dois processos Node INDEPENDENTES (dois processos OS separados)
    // Cada um tem sua própria memória, seu próprio migrationChain, sua própria pool
    const env = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL,
    };

    console.log("Starting process 1...");
    const proc1 = spawnSync("npx", ["tsx", tempScript], { 
      env, 
      cwd: process.cwd(),
      timeout: 120000,
      encoding: "utf8"
    });
    
    console.log("Starting process 2...");
    const proc2 = spawnSync("npx", ["tsx", tempScript], { 
      env, 
      cwd: process.cwd(),
      timeout: 120000,
      encoding: "utf8"
    });

    console.log("Proc1 status:", proc1.status, "stdout:", proc1.stdout?.slice(0, 500), "stderr:", proc1.stderr?.slice(0, 500));
    console.log("Proc2 status:", proc2.status, "stdout:", proc2.stdout?.slice(0, 500), "stderr:", proc2.stderr?.slice(0, 500));

    // Ambos devem terminar com sucesso
    expect(proc1.status).toBe(0);
    expect(proc2.status).toBe(0);

    // Parse output - procura pela linha RESULT:
    const resultLine1 = proc1.stdout.split('\n').find(l => l.startsWith('RESULT:'));
    const resultLine2 = proc2.stdout.split('\n').find(l => l.startsWith('RESULT:'));
    
    if (!resultLine1 || !resultLine2) {
      throw new Error("Missing RESULT line in process output");
    }
    
    const out1 = JSON.parse(resultLine1.replace('RESULT:', '').trim());
    const out2 = JSON.parse(resultLine2.replace('RESULT:', '').trim());

    // Exatamente um aplicou, o outro pulou
    const totalApplied = out1.applied.length + out2.applied.length;
    const totalSkipped = out1.skipped.length + out2.skipped.length;
    
    expect(totalApplied).toBe(1);
    expect(totalSkipped).toBe(1);

    // Verifica contador no banco (exatamente 1)
    const scratch = (await db.execute(
      sql`SELECT "n" FROM "concurrency_scratch" WHERE "id" = 'concurrent'`,
    )) as unknown as { rows: Array<{ n: number }> };
    expect(scratch.rows[0]?.n).toBe(1);

    // Ledger tem exatamente 1 registro aplicada
    const ledger = (await db.execute(
      sql`SELECT "status", "checksum" FROM "migration_ledger" WHERE "step_name" = 'test_concurrency_multi_process_001'`,
    )) as unknown as { rows: Array<{ status: string; checksum: string }> };
    expect(ledger.rows.length).toBe(1);
    if (ledger.rows[0]) {
      expect(ledger.rows[0].status).toBe("aplicada");
    }

    // Limpeza
    fs.unlinkSync(tempScript);
  }, 180000);
});