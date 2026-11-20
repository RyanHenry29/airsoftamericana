// language: TS, file: apps/api/src/db/reset-cli.ts, target: Node CLI
/**
 * `npm run db:reset` — recria o PGlite de DESENVOLVIMENTO do zero.
 *
 * Operação manual e identificada em banco local de desenvolvimento:
 * apaga o diretório do PGlite e semeia de novo. A guarda de alvo roda
 * ANTES do delete: com DATABASE_URL apontando para banco remoto, o comando
 * é recusado (nada é apagado). Nenhum seed/CLI toca Production.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSeedTargetAllowed } from "./seed-target.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

try {
  assertSeedTargetAllowed({
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: process.env.DATABASE_URL ?? "",
    allowRemote: process.env.SEED_ALLOW_REMOTE === "1",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Nada foi apagado.");
  process.exit(1);
}

const configured = process.env.PGLITE_DIR;
const dir = configured
  ? path.isAbsolute(configured)
    ? configured
    : path.resolve(PACKAGE_ROOT, configured)
  : path.join(PACKAGE_ROOT, "data");

rmSync(dir, { recursive: true, force: true });
console.log(`PGlite de desenvolvimento removido: ${dir}`);

const { getDb, closeDb } = await import("./index.js");
const { migrate } = await import("./migrate.js");
const { default: seed } = await import("./seed.js");
const db = await getDb();
try {
  await migrate(db);
  await seed(db);
} finally {
  await closeDb();
}
