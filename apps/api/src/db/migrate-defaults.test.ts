// language: TS, file: apps/api/src/db/migrate-defaults.test.ts, target: vitest
/**
 * Regressão: colunas NOT NULL com DEFAULT declarado no schema Drizzle.
 *
 * O DDL original criou `fraud_rules.action` como NOT NULL SEM default,
 * enquanto o schema (fonte da verdade) declara notNull().default("soma").
 * O bootstrap de produção insere as 7 regras de fraude sem informar `action`
 * → "null value in column action violates not-null constraint" e o bootstrap
 * morre no passo 2 de 3, com o schema já aplicado.
 *
 * O passo 031 alinha o banco ao schema. Este teste trava o comportamento:
 * (1) a coluna tem default 'soma' no banco; (2) insert sem `action` funciona.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "./index.js";
import type { Db } from "./index.js";
import { migrate } from "./migrate.js";
import { fraudRules } from "./schema.js";
import { eq } from "drizzle-orm";

let db: Db;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

afterAll(async () => {
  await closeDb();
});

describe("defaults do banco alinhados ao schema Drizzle", () => {
  it("fraud_rules.action tem DEFAULT 'soma'", async () => {
    const result = (await db.execute(sql`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'fraud_rules' AND column_name = 'action'
    `)) as unknown as { rows: Array<{ column_default: string | null }> };
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.column_default).toContain("'soma'");
  });

  it("insert de regra de fraude SEM action funciona (forma do bootstrap)", async () => {
    const key = "teste_default_action_001";
    await db.delete(fraudRules).where(eq(fraudRules.key, key));
    const [row] = await db
      .insert(fraudRules)
      .values({ key, name: "Regra de teste", enabled: true, weight: 10, threshold: 0 } as never)
      .returning();
    expect(row!.action).toBe("soma");
    await db.delete(fraudRules).where(eq(fraudRules.key, key));
  });
});
