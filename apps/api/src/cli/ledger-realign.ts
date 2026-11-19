// language: TS, file: apps/api/src/cli/ledger-realign.ts, target: Postgres (Supabase)
/**
 * Realinha o checksum de um passo de código no `migration_ledger` quando a
 * divergência é um artefato de quebra de linha (EOL) e não de conteúdo.
 *
 * CONTEXTO: o fingerprint do passo de código é o sha256 do módulo. Antes da
 * canonicalização (CRLF/CR -> LF), a mesma revisão saía diferente no
 * checkout Windows (CRLF) e no Linux (LF). Um banco migrado numa plataforma
 * era recusado na outra (MigrationChecksumError), e o CI quebrava no teste
 * de drift das revisões.
 *
 * SEGURANÇA: a realinhação só acontece se o checksum gravado no ledger for
 * EXATAMENTE o checksum do mesmo passo com a revisão em CRLF (a revisão
 * antiga). Qualquer outra divergência = conteúdo mudou = decisão humana.
 * Nada é executado: só a linha do ledger é corrigida (o passo já foi
 * aplicado; o DDL dele é idempotente).
 *
 * Uso (papel DDL):
 *   DATABASE_URL=postgresql://airsoft_ddl:<pwd>@db.<ref>.supabase.co:5432/postgres?sslmode=require \
 *     npm run db:ledger-realign -w @airsoft/api
 *
 * Sem DATABASE_URL, realinha o PGlite local (apps/api/data) — mesmo mecanismo.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { MIGRATION_STEPS } from "../db/migrate.js";
import { computeStepChecksum } from "../db/migration-ledger.js";
import { moduleRevisionFromSourceAsCrlf } from "../db/module-revision.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(HERE, "..", "db");

async function main(): Promise<void> {
  const target = process.env.DATABASE_URL
    ? "Postgres (DATABASE_URL)"
    : process.env.PGLITE_DIR
      ? `PGlite (PGLITE_DIR=${process.env.PGLITE_DIR})`
      : "PGlite local (apps/api/data)";
  console.log(`== Realinhamento do ledger — alvo: ${target} ==`);

  const { getDb, closeDb } = await import("../db/index.js");
  const db = await getDb();

  const steps = MIGRATION_STEPS.filter(
    (step): step is typeof step & { sourceFile: string; revision: string } =>
      typeof step.run === "function" && typeof step.sourceFile === "string",
  );

  const relineados: string[] = [];
  const recusados: string[] = [];

  try {
    for (const step of steps) {
      const canonicalChecksum = computeStepChecksum(step);
      const rows = await db.execute(sql`
        SELECT "step_name", "checksum", "status"
          FROM "migration_ledger"
         WHERE "step_name" = ${step.name}
      `);
      const row = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
      if (!row) {
        console.log(`- ${step.name}: sem linha no ledger (passo ainda não aplicado)`);
        continue;
      }

      const ledgerChecksum = String(row.checksum);
      const status = String(row.status);
      if (ledgerChecksum === canonicalChecksum) {
        console.log(`= ${step.name}: checksum canônico confere (${status})`);
        continue;
      }
      if (status !== "aplicada") {
        recusados.push(`${step.name}: status ${status} com checksum divergente`);
        continue;
      }

      // Só realinha se o ledger tem o checksum do MESMO passo com a revisão
      // antiga (CRLF). Prova de que a divergência é EOL, não conteúdo.
      const source = readFileSync(path.join(DB_DIR, step.sourceFile));
      const legacyRevision = moduleRevisionFromSourceAsCrlf(source);
      const legacyChecksum = computeStepChecksum({
        ...step,
        revision: legacyRevision,
      } as never);

      if (ledgerChecksum !== legacyChecksum) {
        recusados.push(
          `${step.name}: checksum do ledger não corresponde à revisão CRLF do módulo ` +
            `(ledger=${ledgerChecksum.slice(0, 12)}, crlf=${legacyChecksum.slice(0, 12)}, ` +
            `canônico=${canonicalChecksum.slice(0, 12)}) — conteúdo mudou, decisão humana`,
        );
        continue;
      }

      await db.execute(sql`
        UPDATE "migration_ledger"
           SET "checksum" = ${canonicalChecksum},
               "error" = NULL
         WHERE "step_name" = ${step.name}
      `);
      relineados.push(step.name);
      console.log(
        `+ ${step.name}: checksum realinhado (revisão CRLF ${legacyRevision.slice(0, 19)}… -> ` +
          `canônica ${step.revision.slice(0, 19)}…)`,
      );
    }
  } finally {
    await closeDb();
  }

  if (relineados.length > 0) console.log(`\nRealineados: ${relineados.join(", ")}`);
  if (recusados.length > 0) {
    console.error("\nRecusados (decisão humana):");
    for (const item of recusados) console.error(`  ! ${item}`);
    process.exit(1);
  }
  console.log("\nLedger consistente com o código.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("❌ Realinhamento falhou:", err);
    process.exit(1);
  });
}
