import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import tls from "node:tls";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import * as schema from "./schema.js";
import { SUPABASE_ROOT_CA_PEM } from "./supabase-root-ca.js";
import { benchLogger } from "../lib/query-bench.js";

/**
 * Raiz do pacote (apps/api) — resolvida a partir do próprio arquivo, nunca a
 * partir de process.cwd().
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
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * No Windows o PID é reciclado agressivamente. Exige que o holder seja um
 * processo Node/TS/vitest; caso contrário o lock é tratado como órfão.
 */
function isNodeProcess(pid: number): boolean {
  if (process.platform !== "win32") return true;
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    if (/No tasks are running/i.test(out)) return false;
    const name = out.split('"')[1]?.toLowerCase() ?? "";
    if (!name) return false;
    return /(node|tsx|vitest|electron)/.test(name);
  } catch {
    // Falha ao consultar: em test, preferir não bloquear por falso positivo.
    return process.env.NODE_ENV === "test" ? false : true;
  }
}

/**
 * Trava exclusiva por diretório do PGlite.
 */
function acquirePgliteLock(dir: string): () => void {
  const lockPath = path.join(dir, LOCK_FILE);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          const cur = fs.readFileSync(lockPath, "utf8").trim();
          if (cur === String(process.pid)) fs.rmSync(lockPath, { force: true });
        } catch {
          /* lock já limpo */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      let holder = NaN;
      try {
        holder = Number(fs.readFileSync(lockPath, "utf8").trim());
      } catch {
        holder = NaN;
      }
      if (
        Number.isFinite(holder) &&
        holder > 0 &&
        holder !== process.pid &&
        isProcessAlive(holder) &&
        isNodeProcess(holder)
      ) {
        throw new Error(
          `O banco PGlite em ${dir} já está aberto pelo processo ${holder}. ` +
            "Feche a outra instância da API antes de subir outra — dois processos " +
            "no mesmo diretório corrompem o cluster.",
        );
      }

      try {
        fs.rmSync(lockPath, { force: true });
      } catch {
        /* retry */
      }
    }
  }

  throw new Error(`Não foi possível travar o diretório do PGlite em ${dir}.`);
}

/**
 * Monta `ssl` do Pool para Postgres de produção.
 *
 * Hosts `*.supabase.co` (conexão direta) terminam em CA própria fora das
 * lojas do sistema — a raiz Supabase é pinada aqui, somada às raízes do
 * sistema, com verificação de hostname ligada. O `sslmode` da URL é removido
 * antes de repassar ao pg: o parser sobrescreveria a opção explícita com
 * semântica própria (e sem a nossa CA). Qualquer outro host segue a URL
 * intacta (pooler, Postgres comum, testes locais).
 */
function poolSsl(connectionString: string): { url: string; ssl?: boolean | tls.ConnectionOptions } {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { url: connectionString };
  }
  if (!url.hostname.endsWith(".supabase.co")) return { url: connectionString };

  const mode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  if (mode === "disable") return { url: url.toString(), ssl: false };
  return {
    url: url.toString(),
    ssl: { ca: [SUPABASE_ROOT_CA_PEM, ...tls.rootCertificates] },
  };
}

export async function getDb(): Promise<Db> {
  if (db) return db;

  // Em teste, logger no-op ativa contagem só quando benchStart() é chamado (benchmark/N+1).
  const bench = process.env.NODE_ENV === "test" ? { logger: benchLogger } : {};
  if (config.DATABASE_URL) {
    const { url, ssl } = poolSsl(config.DATABASE_URL);
    poolInstance = new Pool({ connectionString: url, max: 10, ssl });
    db = drizzlePg(poolInstance, { schema, ...bench });
  } else {
    const configured = process.env.PGLITE_DIR;
    const dir = configured
      ? path.isAbsolute(configured)
        ? configured
        : path.resolve(PACKAGE_ROOT, configured)
      : path.join(PACKAGE_ROOT, "data");
    fs.mkdirSync(dir, { recursive: true });
    releaseLock = acquirePgliteLock(dir);
    pgliteInstance = new PGlite(path.join(dir, "airsoft.db"));
    db = drizzlePglite(pgliteInstance, { schema, ...bench });
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
