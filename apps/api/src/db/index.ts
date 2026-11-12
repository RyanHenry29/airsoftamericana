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
 * Versão melhorada: usa lock file com PID + timestamp, cleanup mais robusto.
 */
function acquirePgliteLock(dir: string): () => void {
  const lockPath = path.join(dir, LOCK_FILE);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      const lockData = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
      fs.writeSync(fd, lockData);
      fs.closeSync(fd);
      return () => {
        try {
          const cur = fs.readFileSync(lockPath, "utf8").trim();
          const data = JSON.parse(cur);
          if (data.pid === process.pid) fs.rmSync(lockPath, { force: true });
        } catch {
          /* lock já limpo */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      let holder = NaN;
      try {
        const cur = fs.readFileSync(lockPath, "utf8").trim();
        const data = JSON.parse(cur);
        holder = data.pid;
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

      // Lock órfão ou stale — remove e tenta novamente
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
 * Determina o diretório do banco baseado no ambiente.
 * Garante isolamento total entre dev, test e produção.
 */
function getPgliteDir(): string {
  const env = process.env.NODE_ENV ?? "development";
  const configured = process.env.PGLITE_DIR;

  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(PACKAGE_ROOT, configured);
  }

  // Diretórios isolados por ambiente
  const envDirs: Record<string, string> = {
    development: path.join(PACKAGE_ROOT, "data-dev"),
    test: path.join(PACKAGE_ROOT, "data-test"),
    production: path.join(PACKAGE_ROOT, "data-prod"),
  };

  return envDirs[env] ?? path.join(PACKAGE_ROOT, "data-dev");
}

/**
 * Limpa locks órfãos na inicialização para evitar conflitos com processos
 * anteriores que não liberaram o lock corretamente.
 */
function cleanupStaleLocks(dir: string): void {
  const lockPath = path.join(dir, LOCK_FILE);
  try {
    const content = fs.readFileSync(lockPath, "utf8").trim();
    const pid = Number(content);
    if (Number.isFinite(pid) && pid > 0) {
      const isAlive = isProcessAlive(pid);
      const isNode = isNodeProcess(pid);
      if (!isAlive || !isNode) {
        fs.rmSync(lockPath, { force: true });
      }
    }
  } catch {
    // Lock não existe ou erro de leitura - ignora
  }
}

export async function getDb(): Promise<Db> {
  if (db) return db;

  // Em teste, logger no-op ativa contagem só quando benchStart() é chamado (benchmark/N+1).
  const bench = process.env.NODE_ENV === "test" ? { logger: benchLogger } : {};

  // Se DATABASE_URL está definido, usa PostgreSQL (produção ou dev com Postgres)
  if (config.DATABASE_URL) {
    const { url, ssl } = poolSsl(config.DATABASE_URL);
    // Pooler de transação (porta 6543) não suporta prepared statements; manter
    // pool pequeno em serverless para não esgotar conexões do Supabase.
    const isTransactionPooler = /:6543(?:\/|\?|$)/.test(url);
    poolInstance = new Pool({
      connectionString: url,
      max: isTransactionPooler ? 1 : 5,
      ssl,
      ...(isTransactionPooler ? { connectionTimeoutMillis: 10000 } : {}),
    });
    // pg + Supavisor transaction mode: desativa named prepared statements.
    if (isTransactionPooler) poolInstance.on("connect", (client) => {
      // no-op hook kept for clarity; drizzle/node-postgres uses unnamed prepares by default
      // but we also pass prepare:false to drizzle when needed? drizzle-pg doesn't take prepare here.
      void client;
    });
    db = drizzlePg(poolInstance, { schema, ...bench });
  } else {
    // Sem DATABASE_URL: só permitido em desenvolvimento/teste.
    // Em produção, falha explícita — PGlite NÃO é adequado para produção.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DATABASE_URL é obrigatória em produção. " +
        "Configure a variável de ambiente DATABASE_URL com a string de conexão PostgreSQL. " +
        "PGlite não é suportado em ambiente de produção."
      );
    }

    // Desenvolvimento/teste: usa PGlite com diretório isolado por ambiente
    const dir = getPgliteDir();
    cleanupStaleLocks(dir);
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