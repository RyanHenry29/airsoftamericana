// language: TS, file: apps/api/src/db/migration-concurrency-runner.ts, target: Node.js
// Runner script for multi-process concurrency test
// This file is generated at test runtime and executed via npx tsx

import { getDb, closeDb } from "./index";
import { runMigrationSteps } from "./migration-ledger";

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

async function main() {
  const db = await getDb();
  try {
    const summary = await runMigrationSteps(db, [step]);
    console.log("RESULT:", JSON.stringify({ applied: summary.applied, skipped: summary.skipped }));
  } catch (e: unknown) {
    const err = e as Error;
    console.error("ERROR:", err.message, err.stack);
    process.exit(1);
  } finally {
    await closeDb();
  }
}
main();