// language: TS, file: apps/api/src/db/sync-cli.ts, target: PGlite/Postgres
/**
 * Ferramenta de diagnose: mostra as colunas que o schema pede e o banco não tem.
 *   npx tsx src/db/sync-cli.ts            -> só relatório
 *   npx tsx src/db/sync-cli.ts --apply    -> aplica as colunas que faltam
 */
import { getDb } from "./index.js";
import { diffSchema, syncSchemaColumns } from "./sync-columns.js";

const db = await getDb();
const diff = await diffSchema(db);

console.log(`FALTANDO NO BANCO: ${diff.missingColumns.length}`);
for (const column of diff.missingColumns) {
  console.log(
    `  - ${column.table}.${column.column} ${column.sqlType} notNull=${column.notNull} default=${column.defaultSql ?? "-"}`,
  );
}

console.log(`COLUNAS EXTRAS NO BANCO: ${diff.extraColumns.length}`);
for (const column of diff.extraColumns) {
  console.log(`  + ${column.table}.${column.column}`);
}

if (process.argv.includes("--apply")) {
  const applied = await syncSchemaColumns(db);
  console.log(`APLICADO: ${applied.length}`);
  for (const statement of applied) console.log(`  + ${statement}`);
}

process.exit(0);
