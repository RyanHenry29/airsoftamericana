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
  // Inclui pg_sleep(2) para manter o lock enquanto o segundo processo tenta adquirir
  const step = {
    name: "test_concurrency_multi_process_001",
    description: "passo sintético para teste multi-processo",
    statements: [
      `CREATE TABLE IF NOT EXISTS "concurrency_scratch" ("id" text PRIMARY KEY, "n" integer NOT NULL);`,
      `INSERT INTO "concurrency_scratch" ("id", "n") VALUES ('concurrent', 0) ON CONFLICT ("id") DO NOTHING;`,
      `UPDATE "concurrency_scratch" SET "n" = "n" + 1 WHERE "id" = 'concurrent';`,
      `SELECT pg_sleep(2);`, // Mantém o lock por 2s para forçar contenção real
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
        `SELECT pg_sleep(2);`, // Mantém o lock por 2s para forçar contenção real
      ],
      nonIdempotent: false,
    };

    const { spawn } = await import("node:child_process");
    const path = await import("node:path");
    const os = await import("node:os");
    const fs = await import("node:fs");
    const tempScript = path.join(os.tmpdir(), `concurrency_runner_${Date.now()}.ts`);
    
    // Build runner script - usa caminhos relativos ao CWD (apps/api no pg-integration)
    const runnerLines = [
      'import { getDb, closeDb } from "./src/db/index.ts";',
      'import { runMigrationSteps } from "./src/db/migration-ledger.ts";',
      '',
      'const step = {',
      '  name: "test_concurrency_multi_process_001",',
      '  description: "passo sintético para teste multi-processo",',
      '  statements: [',
      '    `CREATE TABLE IF NOT EXISTS "concurrency_scratch" ("id" text PRIMARY KEY, "n" integer NOT NULL);`,',
      '    `INSERT INTO "concurrency_scratch" ("id", "n") VALUES (\'concurrent\', 0) ON CONFLICT ("id") DO NOTHING;`,',
      '    `UPDATE "concurrency_scratch" SET "n" = "n" + 1 WHERE "id" = \'concurrent\';`,',
      '    `SELECT pg_sleep(2);`,',
      '  ],',
      '  nonIdempotent: false,',
      '};',
      '',
      'async function main() {',
      '  const db = await getDb();',
      '  try {',
      '    const summary = await runMigrationSteps(db, [step]);',
      '    console.log("RESULT:", JSON.stringify({ applied: summary.applied, skipped: summary.skipped }));',
      '  } catch (e) {',
      '    const err = e as Error;',
      '    console.error("ERROR:", err.message, err.stack);',
      '    process.exitCode = 1;',
      '  } finally {',
      '    await closeDb();',
      '  }',
      '}',
      'main();',
    ];
    
    const runnerScript = runnerLines.join('\n');
    fs.writeFileSync(tempScript, runnerScript);

    // Inicia dois processos Node INDEPENDENTES (dois processos OS separados)
    // Cada um tem sua própria memória, seu próprio migrationChain, sua própria pool
    const env = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL,
    };

    console.log("Starting process 1...");
    const proc1 = spawn("npx", ["tsx", tempScript], { 
      env, 
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      shell: true, // Windows: resolve npx.cmd
    });
    
    console.log("Starting process 2...");
    const proc2 = spawn("npx", ["tsx", tempScript], { 
      env, 
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      shell: true, // Windows: resolve npx.cmd
    });

    // Aguarda ambos os processos CONCORRENTEMENTE
    const [result1, result2] = await Promise.all([
      waitForProcess(proc1),
      waitForProcess(proc2),
    ]);

    console.log("Proc1 status:", result1.status, "stdout:", result1.stdout?.slice(0, 500), "stderr:", result1.stderr?.slice(0, 500));
    console.log("Proc2 status:", result2.status, "stdout:", result2.stdout?.slice(0, 500), "stderr:", result2.stderr?.slice(0, 500));

    // Ambos devem terminar com sucesso
    expect(result1.status).toBe(0);
    expect(result2.status).toBe(0);

    // Parse output - procura pela linha RESULT:
    const resultLine1 = result1.stdout.split('\n').find(l => l.startsWith('RESULT:'));
    const resultLine2 = result2.stdout.split('\n').find(l => l.startsWith('RESULT:'));
    
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

    // Limpeza - sempre executada
    fs.unlinkSync(tempScript);
  }, 180000);
});

// Helper para aguardar processo assíncrono
function waitForProcess(proc: ReturnType<typeof import("node:child_process").spawn>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    
    const resolveOnce = (value: { status: number | null; stdout: string; stderr: string }) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(value);
      }
    };
    
    const rejectOnce = (reason: Error) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(reason);
      }
    };
    
    proc.stdout?.on("data", (data) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data) => { stderr += data.toString(); });
    
    proc.on("error", (err) => {
      rejectOnce(new Error(`Process spawn error: ${err.message}`));
    });
    
    proc.on("close", (code) => {
      resolveOnce({ status: code, stdout, stderr });
    });
    
    // Timeout de segurança
    timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      rejectOnce(new Error("Process timeout"));
    }, 130000);
  });
}