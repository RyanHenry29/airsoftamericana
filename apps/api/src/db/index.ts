import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import * as schema from "./schema.js";

/**
 * Raiz do pacote (apps/api) — resolvida a partir do próprio arquivo, nunca a
 * partir de process.cwd(). O cwd muda conforme quem lanza a API (workspace do
 * npm, npx na raiz do repo, script manual) e cada variação abria um PGlite
 * diferente no mesmo seed — foi o que duplicou o banco e corrompeu o cluster.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

let db: Db | undefined;
let pgliteInstance: PGlite | undefined;
let poolInstance: Pool | undefined;
let releaseLock: (() => void) | undefined;

const LOCK_FILE = ".pglite.lock";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = existe, mas sem permissão (no Windows acontece com PID de outro
    // usuário) — do ponto de vista do lock, o processo está vivo.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Trava exclusiva por diretório do PGlite.
 *
 * O PGlite não tolera dois processos no mesmo diretório: o segundo abre o
 * cluster enquanto o primeiro ainda escreve e o resultado são relações com
 * arquivo de 0 bytes (foi o que destruiu o banco de dev). A trava faz a
 * segunda instância recusar a subida com uma mensagem clara, em vez de
 * corromper o cluster em silêncio.
 */
function acquirePgliteLock(dir: string): () => void {
  const lockPath = path.join(dir, LOCK_FILE);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          /* lock já limpo */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      const raw = fs.readFileSync(lockPath, "utf8").trim();
      const holder = Number(raw);
      if (Number.isFinite(holder) && holder > 0 && holder !== process.pid && isProcessAlive(holder)) {
        throw new Error(
          `O banco PGlite em ${dir} já está aberto pelo processo ${holder}. ` +
            "Feche a outra instância da API antes de subir outra — dois processos " +
            "no mesmo diretório corrompem o cluster.",
        );
      }

      // Lock órfão (processo morto): assume a trava e tenta de novo.
      fs.rmSync(lockPath, { force: true });
    }
  }

  throw new Error(`Não foi possível travar o diretório do PGlite em ${dir}.`);
}

export async function getDb(): Promise<Db> {
  if (db) return db;

  if (config.DATABASE_URL) {
    poolInstance = new Pool({ connectionString: config.DATABASE_URL, max: 10 });
    db = drizzlePg(poolInstance, { schema });
  } else {
    // PGLITE_DIR isola dev/test/prod sem servidor externo. Caminho absoluto
    // manda; relativo é resolvido a partir da raiz do pacote (nunca do cwd),
    // para que qualquer comando de lançamento aponte o mesmo diretório.
    const configured = process.env.PGLITE_DIR;
    const dir = configured
      ? path.isAbsolute(configured)
        ? configured
        : path.resolve(PACKAGE_ROOT, configured)
      : path.join(PACKAGE_ROOT, "data");
    fs.mkdirSync(dir, { recursive: true });
    releaseLock = acquirePgliteLock(dir);
    pgliteInstance = new PGlite(path.join(dir, "airsoft.db"));
    db = drizzlePglite(pgliteInstance, { schema });
  }
  return db;
}

export function setDb(instance: Db): void {
  db = instance;
}

export async function closeDb(): Promise<void> {
  if (pgliteInstance) await pgliteInstance.close();
  if (poolInstance) await poolInstance.end();
  releaseLock?.();
  releaseLock = undefined;
  db = undefined;
  pgliteInstance = undefined;
  poolInstance = undefined;
}

export { schema };
