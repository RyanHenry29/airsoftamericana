// language: JS (ESM), file: scripts/build-migration-steps.mjs
// One-shot: converte o blob idempotente de apps/api/src/db/migrate.ts em passos
// nomeados (MigrationStep[]) preservando o SQL byte a byte. Roda UMA vez no
// refactor AUD-03; mantido como registro do processo.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const SRC = "apps/api/src/db/migrate.ts";
const raw = readFileSync(SRC, "utf8");

// ---- 1. statements: todos os spans `await db.execute(sql`...`);` na ordem ----
const stmtRe = /await\s+db\.execute\((?:sql|sql\.raw)\s*`([\s\S]*?)`\s*\);/g;
const statements = [];
let m;
while ((m = stmtRe.exec(raw)) !== null) {
  if (m[1].includes("`")) throw new Error(`backtick interno em statement @${m.index}`);
  if (m[1].includes("${")) throw new Error(`interpolação em statement @${m.index}`);
  statements.push({ text: m[1], start: m.index, end: m.index + m[0].length });
}
if (statements.length !== 223) throw new Error(`esperado 223 statements, achados ${statements.length}`);

// ---- 2. seções: marcadores `// ---- Título ----` ----
const markerRe = /^[ \t]*\/\/ -+ (.+)$/gm;
const markers = [];
let mk;
while ((mk = markerRe.exec(raw)) !== null) {
  markers.push({ title: mk[1].trim(), index: mk.index });
}

// ---- 3. atribui statements a seções ----
const sections = [];
for (let i = 0; i < markers.length; i++) {
  const from = markers[i].index;
  const to = i + 1 < markers.length ? markers[i + 1].index : raw.length;
  const stmts = statements.filter((s) => s.start > from && s.end < to).map((s) => s.text);
  sections.push({ title: markers[i].title, statements: stmts });
}
const totalInSections = sections.reduce((a, s) => a + s.statements.length, 0);
if (totalInSections !== statements.length) throw new Error(`statements fora de seção: ${statements.length - totalInSections}`);

// ---- 4. nomes únicos (slug ASCII, dedup) ----
function slugify(t) {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "step";
}
const used = new Map();
const named = sections.map((s, i) => {
  const base = slugify(s.title);
  const n = (used.get(base) ?? 0) + 1;
  used.set(base, n);
  const name = `${String(i + 1).padStart(3, "0")}_${n > 1 ? base + "_cont" + (n > 2 ? n - 1 : "") : base}`;
  return { ...s, name };
});

// ---- 5. revisões dos passos de código (sha256 do conteúdo do módulo) ----
function fileHash(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 32);
}
const syncRevision = fileHash("apps/api/src/db/sync-columns.ts");
const rolesRevision = fileHash("apps/api/src/db/migrate-roles.ts");

// ---- 6. emitir novo migrate.ts ----
const esc = (t) => t; // statements são template literals sem backtick/${ — verificado acima
const stepBlocks = named
  .filter((s) => s.statements.length > 0)
  .map((s) => {
    const stmts = s.statements.map((t) => "      " + "`" + esc(t.trimEnd()) + "`,");
    return `  {
    name: "${s.name}",
    description: ${JSON.stringify(s.title)},
    statements: [
${stmts.join("\n")}
    ],
  },`;
  })
  .join("\n");

const header = `// language: TS, file: apps/api/src/db/migrate.ts
// Migrações em PASSOS nomeados e coordenados (AUD-03): cada passo tem checksum
// sha256 automático, execução transacional com registro no migration_ledger,
// coordenação por advisory lock (multi-instância) e recuperação de passos
// interrompidos. Cada statement usa IF NOT EXISTS: reexecutar é seguro em
// dev, test e prod. Compatível com Postgres e PGlite (PG13+).
import { sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { syncSchemaColumns } from "./sync-columns.js";
import { migrateLegacyRoles } from "./migrate-roles.js";
import { runMigrationSteps, type MigrationStep, type MigrationRunSummary } from "./migration-ledger.js";

/**
 * Revisões dos passos de código: hash sha256 (truncado) do conteúdo do
 * módulo no momento do refactor. BUMPE O valor quando alterar o módulo —
 * o ledger recusa checksum divergente.
 */
const SYNC_SCHEMA_COLUMNS_REVISION = "sha256:${syncRevision}";
const MIGRATE_LEGACY_ROLES_REVISION = "sha256:${rolesRevision}";

/**
 * Passos de migração, em ordem. Passos SQL: statements executados dentro de
 * uma transação única com o registro no ledger (aplicada ou nada). Passos de
 * código: função \`run\` idempotente, revision explícito.
 */
export const MIGRATION_STEPS: MigrationStep[] = [
`;

const codeSteps = `  {
    name: "029_sync_schema_columns",
    description: "Sync schema columns (idempotent)",
    revision: SYNC_SCHEMA_COLUMNS_REVISION,
    run: async (db: Db) => {
      await syncSchemaColumns(db);
    },
  },
  {
    name: "030_migrate_legacy_roles",
    description: "Migrate legacy roles (idempotent)",
    revision: MIGRATE_LEGACY_ROLES_REVISION,
    run: async (db: Db) => {
      await migrateLegacyRoles(db);
    },
  },
];

/**
 * Coordenador: executa os passos sob advisory lock, com ledger, checksum e
 * recuperação de interrupções. Assinatura preservada — todos os chamadores
 * (boot, seed, CLIs, testes) continuam válidos.
 */
export async function migrate(db: Db): Promise<MigrationRunSummary> {
  return runMigrationSteps(db, MIGRATION_STEPS);
}
`;

writeFileSync(SRC, header + stepBlocks + "\n" + codeSteps, "utf8");
console.log(`OK: ${named.length} seções, ${statements.length} statements, revisões: sync=${syncRevision.slice(0, 8)} roles=${rolesRevision.slice(0, 8)}`);
console.log(named.map((s) => `${s.name} (${s.statements.length})`).join("\n"));
