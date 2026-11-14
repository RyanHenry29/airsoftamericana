// language: TS, file: apps/api/src/db/migration-ledger.test.ts, target: Postgres/PGlite
// AUD-03: ledger, checksum, advisory lock, recuperação de interrupções.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, closeDb, setDb } from "./index.js";
import type { Db } from "./index.js";
import { migrate, MIGRATION_STEPS } from "./migrate.js";
import {
  MigrationChecksumError,
  MigrationNonIdempotentError,
  computeStepChecksum,
  runMigrationSteps,
} from "./migration-ledger.js";

let db: Db;

beforeAll(async () => {
  db = await getDb();
  setDb(db);
  // Autolimpeza: um run abortado (crash, restart do servidor) deixa passos
  // sintéticos 'test_%' no ledger persistido e a tabela scratch com contagem
  // residual — o UPDATE n = n + 1 do passo de concorrência é propositalmente
  // não-idempotente. Tabela pode não existir em DB fresco: try/catch.
  try {
    await db.execute(sql`DELETE FROM "migration_ledger" WHERE "step_name" LIKE 'test_%'`);
    await db.execute(sql`DROP TABLE IF EXISTS "migration_scratch_test"`);
  } catch {
    // DB fresco sem o ledger ainda: migrate() do primeiro teste cria tudo
  }
});

afterAll(async () => {
  await closeDb();
});

async function ledgerRow(stepName: string): Promise<{ status: string; checksum: string; error: string | null }> {
  const result = (await db.execute(
    sql`SELECT "status", "checksum", "error" FROM "migration_ledger" WHERE "step_name" = ${stepName}`,
  )) as unknown as { rows: Array<{ status: string; checksum: string; error: string | null }> };
  const row = result.rows[0];
  if (!row) throw new Error(`linha do ledger ausente para ${stepName}`);
  return row;
}

describe("AUD-03: migration ledger", () => {
  it("migrate() aplica todos os passos com checksum registrado", async () => {
    const summary = await migrate(db);
    expect(summary.recovered).toEqual([]);
    const rows = (await db.execute(
      sql`SELECT "step_name", "status", "checksum" FROM "migration_ledger" ORDER BY "step_name"`,
    )) as unknown as { rows: Array<{ step_name: string; status: string; checksum: string }> };
    expect(rows.rows.length).toBe(MIGRATION_STEPS.length);
    for (const row of rows.rows) {
      expect(row.status).toBe("aplicada");
      const step = MIGRATION_STEPS.find((s) => s.name === row.step_name)!;
      expect(row.checksum).toBe(computeStepChecksum(step));
    }
  });

  it("re-execução é no-op: tudo skipped, zero aplicado, zero recuperado", async () => {
    const before = (await db.execute(
      sql`SELECT count(*)::int AS n FROM "migration_ledger"`,
    )) as unknown as { rows: Array<{ n: number }> };
    const summary = await migrate(db);
    expect(summary.applied).toEqual([]);
    expect(summary.recovered).toEqual([]);
    expect(summary.skipped.length).toBe(MIGRATION_STEPS.length);
    const after = (await db.execute(
      sql`SELECT count(*)::int AS n FROM "migration_ledger"`,
    )) as unknown as { rows: Array<{ n: number }> };
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("checksum divergente (código alterado após aplicar) REFUSA o run", async () => {
    await db.execute(sql`UPDATE "migration_ledger" SET "checksum" = 'deadbeef00000000' WHERE "step_name" = '002_clientes'`);
    try {
      await expect(migrate(db)).rejects.toBeInstanceOf(MigrationChecksumError);
    } finally {
      await db.execute(
        sql`UPDATE "migration_ledger" SET "checksum" = ${computeStepChecksum(MIGRATION_STEPS.find((s) => s.name === "002_clientes")!)} WHERE "step_name" = '002_clientes'`,
      );
    }
  });

  it("passo interrompido (in_progress de run anterior) é RECUPERADO e marcado aplicada", async () => {
    await db.execute(
      sql`UPDATE "migration_ledger" SET "status" = 'in_progress', "error" = 'crash simulado' WHERE "step_name" = '023_settings'`,
    );
    const summary = await migrate(db);
    expect(summary.recovered).toContain("023_settings");
    expect(summary.applied).toContain("023_settings");
    const row = await ledgerRow("023_settings");
    expect(row.status).toBe("aplicada");
    expect(row.error).toContain("recuperado");
  });

  it("passo non-idempotente com run anterior não concluído REFUSA re-execução automática", async () => {
    const step = {
      name: "test_nonidem_001",
      description: "passo sintético non-idempotente",
      revision: "rev-test-1",
      run: async () => {},
      nonIdempotent: true,
    };
    const correctChecksum = computeStepChecksum(step);
    const result = (await db.execute(
      sql`INSERT INTO "migration_ledger" ("step_name", "checksum", "status", "instance_id", "error")
          VALUES (${step.name}, ${correctChecksum}, 'in_progress', 'test', 'simulado')
          ON CONFLICT ("step_name") DO UPDATE SET "status" = 'in_progress'`,
    )) as unknown as { rows: Array<Record<string, unknown>> };
    void result;
    await expect(runMigrationSteps(db, [step])).rejects.toBeInstanceOf(MigrationNonIdempotentError);
    await db.execute(sql`DELETE FROM "migration_ledger" WHERE "step_name" = ${step.name}`);
  });

  it("duas instâncias em paralelo: execução serializada, exatamente-uma aplicação", async () => {
    await db.execute(sql`DROP TABLE IF EXISTS "migration_scratch_test"`);
    const steps = [
      {
        name: "test_parallel_001",
        description: "passo sintético de concorrência",
        statements: [
          `CREATE TABLE IF NOT EXISTS "migration_scratch_test" ("id" text PRIMARY KEY, "n" integer NOT NULL);`,
          `INSERT INTO "migration_scratch_test" ("id", "n") VALUES ('concurrent', 0) ON CONFLICT ("id") DO NOTHING;`,
          `UPDATE "migration_scratch_test" SET "n" = "n" + 1 WHERE "id" = 'concurrent';`,
        ],
      },
    ];
    // Duas "instâncias" (duas chamadas simultâneas do runner, cada uma com
    // sessão própria via getMigrationSession). O advisory lock serializa; o
    // segundo run lê o ledger e salta o passo já aplicado.
    const [a, b] = await Promise.all([
      runMigrationSteps(db, steps),
      runMigrationSteps(db, steps),
    ]);
    const runs = [a, b];
    const applied = runs.flatMap((r) => r.applied);
    expect(applied).toContain("test_parallel_001");
    // exatamente-uma aplicação: se ambas aplicassem, n = 2
    const scratch = (await db.execute(
      sql`SELECT "n" FROM "migration_scratch_test" WHERE "id" = 'concurrent'`,
    )) as unknown as { rows: Array<{ n: number }> };
    expect(scratch.rows[0]?.n).toBe(1);
    expect((await ledgerRow("test_parallel_001")).status).toBe("aplicada");
    await db.execute(sql`DELETE FROM "migration_ledger" WHERE "step_name" = 'test_parallel_001'`);
    await db.execute(sql`DROP TABLE IF EXISTS "migration_scratch_test"`);
  });

  it("checksum do passo é estável entre chamadas (deriva só do conteúdo)", async () => {
    const step = MIGRATION_STEPS.find((s) => s.name === "008_pagamentos")!;
    expect(computeStepChecksum(step)).toBe(computeStepChecksum({ ...step }));
    expect(computeStepChecksum(step)).not.toBe(computeStepChecksum({ ...step, name: step.name + "_x" }));
  });
});
