import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import tls from "node:tls";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import * as schema from "./schema.js";
import { SUPABASE_ROOT_CA_PEM } from "./supabase-root-ca.js";
import { assertSessionScopeSafe, classifyPooler, poolSizing } from "./pool-mode.js";
import { setDbRuntimeInfo, dbInstanceId } from "./db-trace.js";
import { createResilientPool, errorCode } from "./db-retry.js";
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
 * Monta `ssl` e normaliza a URL do Pool para Postgres de produção.
 *
 * Hosts `*.supabase.co` (conexão direta) terminam em CA própria fora das
 * lojas do sistema — a raiz Supabase é pinada aqui, somada às raízes do
 * sistema, com verificação de hostname ligada. O `sslmode` da URL é removido
 * antes de repassar ao pg: o parser sobrescreveria a opção explícita com
 * semântica própria (e sem a nossa CA).
 *
 * Outros hosts (pooler Supabase `*.pooler.supabase.com`, Postgres comum)
 * respeitam `sslmode` da URL convertendo para a opção `ssl` explícita do pg,
 * evitando que o parser imponha comportamento inesperado em runtime serverless.
 */
function poolSsl(connectionString: string): { url: string; ssl?: boolean | tls.ConnectionOptions } {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { url: connectionString };
  }

  const mode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  url.searchParams.delete("sslmode");

  if (url.hostname.endsWith(".supabase.co")) {
    if (mode === "disable") return { url: url.toString(), ssl: false };
    return {
      url: url.toString(),
      ssl: { ca: [SUPABASE_ROOT_CA_PEM, ...tls.rootCertificates] },
    };
  }

  // Pooler/outros: `require`/`verify-*`/ausente em URL postgres => TLS.
  // `prefer` fica sem forçar (pg decide); `disable` desliga.
  if (mode === "disable") return { url: url.toString(), ssl: false };
  if (mode === "prefer" || mode === "allow") return { url: url.toString() };
  if (mode || url.hostname.endsWith(".pooler.supabase.com")) {
    return { url: url.toString(), ssl: { rejectUnauthorized: mode !== "require" ? true : false } };
  }
  return { url: url.toString() };
}

/**
 * Abre o pool do Postgres.
 *
 * `connectionString` explícita vence a `DATABASE_URL` da config: o runtime
 * serverless passa a URL do pooler em transaction mode (DATABASE_URL_RUNTIME),
 * enquanto o CLI de migrations usa a DATABASE_URL de session mode (o advisory
 * lock do ledger é de sessão).
 */
export async function getDb(connectionString?: string): Promise<Db> {
  if (db) return db;

  // Em teste, logger no-op ativa contagem só quando benchStart() é chamado (benchmark/N+1).
  const bench = process.env.NODE_ENV === "test" ? { logger: benchLogger } : {};
  const raw = (connectionString ?? config.DATABASE_URL ?? "").trim();
  if (raw) {
    const { url, ssl } = poolSsl(raw);
    // Dimensiona por modo de pooler: transaction/session aceitam uma conexão
    // por instância (o pooler limita os clientes do projeto, não a instância).
    const sizing = poolSizing(classifyPooler(raw));
    setDbRuntimeInfo({
      poolMax: sizing.max,
      acquireTimeoutMs: sizing.connectionTimeoutMillis,
      instanceId: dbInstanceId(),
    });
    poolInstance = createResilientPool(
      {
        connectionString: url,
        max: sizing.max,
        ssl,
        connectionTimeoutMillis: sizing.connectionTimeoutMillis,
        // Conexão ociosa devolve a vaga ao pooler: instância aquecida não
        // segura vaga do teto global (200 clientes por projeto).
        idleTimeoutMillis: sizing.idleTimeoutMillis,
      },
      {
        onRetry: ({ attempt, delayMs, error, phase, budgetLeftMs }) => {
          console.warn(
            `[db] retry ${attempt} em ${delayMs}ms (${phase}) — ${errorCode(error) ?? "erro transitório"} · resta ${budgetLeftMs}ms`,
          );
        },
      },
    );
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
    // PGlite é single-session: não há pool de conexões. Mas a telemetria tem
    // que refletir o runtime REAL — sem isto o healthz reportaria `pmax=0` e
    // `ctmo=0` em dev/local, que é informação falsa.
    setDbRuntimeInfo({
      poolMax: 1,
      acquireTimeoutMs: 0,
      instanceId: dbInstanceId(),
    });
    db = drizzlePglite(pgliteInstance, { schema, ...bench });
  }
  return db;
}

export function setDb(instance: Db): void {
  db = instance;
}

/**
 * Verifica se há pool PostgreSQL configurado (para migrations).
 */
export function poolInstanceExists(): boolean {
  return !!poolInstance;
}

/**
 * Sessão EXCLUSIVA para migrations (AUD-03): o advisory lock é por SESSÃO —
 * executado no pool genérico, cada query pode cair em conexão diferente e a
 * coordenação multi-instância não serializa nada. Aqui: um cliente dedicado
 * do pool carrega lock + ledger + DDL do começo ao fim do run.
 *
 * Exige pooler em SESSION MODE (porta 5432) ou conexão direta: em transaction
 * mode (6543) o backend pode trocar entre comandos e o lock se perde.
 * `assertSessionScopeSafe` recusa a URL errada antes de qualquer DDL.
 *
 * SOMENTE para backends com pool (Postgres). PGlite é single-session por
 * natureza: qualquer query fora do callback de transaction() trava atrás do
 * BEGIN aberto — passar o db do módulo aqui causaria deadlock quando o
 * chamador rodar migrate() DENTRO de uma transação (fault-injection, seed).
 * Nesses casos o motor usa o db recebido (tx-aware), como o blob original.
 */
export async function getMigrationSession(): Promise<{
  db: Db;
  release: (lockFailed?: boolean) => Promise<void>;
}> {
  if (!poolInstance) {
    throw new Error(
      "getMigrationSession exige pool (Postgres); PGlite usa o db do chamador (single-session)",
    );
  }
  const client = await poolInstance.connect();
  return {
    db: drizzlePg(client, { schema }),
    release: async (lockFailed?: boolean) => {
      if (lockFailed) {
        client.release(new Error("Migration advisory lock cleanup failed"));
        return;
      }
      client.release();
    },
  };
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
export { assertSessionScopeSafe };
