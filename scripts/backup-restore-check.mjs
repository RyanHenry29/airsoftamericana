// language: JS (ESM), file: scripts/backup-restore-check.mjs, target: PostgreSQL 17.12
/**
 * Backup e restauração COMPROVADOS (Fase 1.5 do checklist operacional).
 *
 * 1. Sobe um PostgreSQL 17.12 local (initdb/pg_ctl dos binários oficiais) — destino da restauração.
 * 2. pg_dump -Fc do STAGING (papel DDL, conexão direta)          -> staging.dump
 * 3. pg_dump -Fc da PRODUÇÃO (papel runtime, pooler Session)       -> production.dump (só leitura)
 * 4. pg_restore de cada dump em um banco local limpo, com os papéis airsoft_* recriados.
 * 5. Compara contagem de linhas de TODAS as tabelas do schema public:
 *    origem (banho de origem) x destino (banco restaurado), e confere os GRANTs.
 *
 * Nada é escrito nos bancos de origem: pg_dump é somente-leitura.
 * Uso:
 *   node scripts/backup-restore-check.mjs \
 *     --staging "postgresql://airsoft_ddl:<pwd>@db.<ref>.supabase.co:5432/postgres?sslmode=require" \
 *     --production "postgresql://airsoft_app.<ref>:<pwd>@aws-1-....pooler.supabase.com:5432/postgres?sslmode=require" \
 *     --pg-tools "C:/.../pg17/pgsql/bin"
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const apiRequire = createRequire(path.join(process.cwd(), "apps", "api", "package.json"));
const { Client } = apiRequire("pg");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const STAGING_URL = args.staging;
const PRODUCTION_URL = args.production;
const PG_TOOLS = args["pg-tools"] ?? "";
const PORT = Number(args.port ?? 55433);
const OUT_DIR = args.out ?? path.join(os.tmpdir(), "airsoft-backup-check");

if (!STAGING_URL || !PRODUCTION_URL || !PG_TOOLS) {
  console.error("uso: node scripts/backup-restore-check.mjs --staging <url> --production <url> --pg-tools <dir bin>");
  process.exit(2);
}

const bin = (name) => path.join(PG_TOOLS, name);
const pgDump = bin("pg_dump.exe");
const pgRestore = bin("pg_restore.exe");
const psql = bin("psql.exe");
const initdb = bin("initdb.exe");
const pgCtl = bin("pg_ctl.exe");
for (const b of [pgDump, pgRestore, psql, initdb, pgCtl]) {
  if (!existsSync(b)) {
    console.error(`binario ausente: ${b}`);
    process.exit(2);
  }
}

function splitUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || "postgres",
  };
}

async function connect(url, overrides = {}) {
  const c = splitUrl(url);
  const client = new Client({ ...c, ssl: { rejectUnauthorized: false }, ...overrides });
  await client.connect();
  return client;
}

async function countAllTables(client) {
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
  );
  const counts = {};
  if (tables.rows.length === 0) return counts;
  const selects = tables.rows
    .map(({ table_name }) => `(SELECT count(*)::int FROM "${table_name}") AS "${table_name}"`)
    .join(", ");
  const r = await client.query(`SELECT ${selects}`);
  for (const { table_name } of tables.rows) counts[table_name] = r.rows[0][table_name];
  return counts;
}

function log(...a) {
  console.error(`[backup-check] ${new Date().toISOString()} ${a.join(" ")}`);
}

function run(cmd, cmdArgs, env = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: false,
    timeout: 600000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error ? String(res.error) : null };
}

function dump(url, outFile) {
  const c = splitUrl(url);
  return run(
    pgDump,
    [
      "-h", c.host, "-p", String(c.port), "-U", c.user, "-d", c.database,
      "-n", "public", "--format=custom", "--no-comments", "--file", outFile,
    ],
    { PGPASSWORD: c.password, PGSSLMODE: "require" },
  );
}

const dataDir = mkdtempSync(path.join(os.tmpdir(), "airsoft-restore-"));
mkdirSync(OUT_DIR, { recursive: true });
const report = { outDir: OUT_DIR, staging: {}, production: {}, tablesCompared: 0, mismatches: [], errors: [] };
let started = false;

try {
  log(`initdb em ${dataDir}`);
  const init = run(initdb, ["-D", dataDir, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--locale=C"]);
  if (init.status !== 0) {
    report.errors.push(`initdb falhou: ${init.stderr.slice(0, 400)}`);
    throw new Error("initdb");
  }
  const logFile = path.join(dataDir, "server.log");
  writeFileSync(logFile, "");
  const start = run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-p ${PORT} -h 127.0.0.1 -c listen_addresses=127.0.0.1`, "-w", "-t", "60", "start"]);
  if (start.status !== 0) {
    report.errors.push(`pg_ctl start falhou: ${start.stderr.slice(0, 400)} ${readFileSync(logFile, "utf8").slice(-800)}`);
    throw new Error("pg_ctl start");
  }
  started = true;
  const ver = run(psql, ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", "postgres", "-tAc", "SHOW server_version"]);
  report.localServer = `PostgreSQL local ${ver.stdout.trim()} na porta ${PORT}`;

  const localAdmin = { host: "127.0.0.1", port: PORT, user: "postgres", database: "postgres" };

  const roleClient = new Client(localAdmin);
  await roleClient.connect();
  // papéis da plataforma Supabase (anon/authenticated/service_role/...) + os nossos:
  // recriados para que os GRANTs do dump sejam restaurados sem erro.
  await roleClient.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='airsoft_ddl') THEN CREATE ROLE airsoft_ddl NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='airsoft_app') THEN CREATE ROLE airsoft_app NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='diag_audit') THEN CREATE ROLE diag_audit NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pgbouncer') THEN CREATE ROLE pgbouncer NOLOGIN; END IF;
    END $$;
  `);
  await roleClient.end();

  const targets = [
    { key: "staging", url: STAGING_URL, db: "restore_staging" },
    { key: "production", url: PRODUCTION_URL, db: "restore_production" },
  ];

  for (const t of targets) {
    const dumpFile = path.join(OUT_DIR, `${t.key}.dump`);

    log(`pg_dump ${t.key} ...`);
    const d = dump(t.url, dumpFile);
    log(`pg_dump ${t.key} exit=${d.status} ${d.error ?? ""}`);
    if (d.status !== 0) {
      report.errors.push(`${t.key}: pg_dump falhou (exit ${d.status}) — ${d.stderr.trim().slice(0, 400)}`);
      continue;
    }
    const bytes = readFileSync(dumpFile);
    const sha = createHash("sha256").update(bytes).digest("hex");

    log(`contando tabelas na origem ${t.key} ...`);
    const src = await connect(t.url);
    const srcCounts = await countAllTables(src);
    await src.end();
    log(`origem ${t.key}: ${Object.keys(srcCounts).length} tabelas`);

    const createDb = run(psql, ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", "postgres", "-c", `CREATE DATABASE ${t.db}`]);
    if (createDb.status !== 0) {
      report.errors.push(`${t.key}: CREATE DATABASE falhou — ${createDb.stderr.trim().slice(0, 300)}`);
    }

    log(`pg_restore ${t.key} ...`);
    const r = run(pgRestore, ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", t.db, "--clean", "--if-exists", dumpFile]);
    log(`pg_restore ${t.key} exit=${r.status} ${r.error ?? ""}`);
    const restoreErrors = (r.stderr || "").split(/\r?\n/).filter((l) => l && /error/i.test(l)).slice(0, 10);

    const restored = new Client({ ...localAdmin, database: t.db });
    await restored.connect();
    const restoredCounts = await countAllTables(restored);
    const grants = await restored.query(`
      SELECT table_name, grantee, privilege_type
        FROM information_schema.role_table_grants
       WHERE table_schema='public' AND grantee IN ('airsoft_app','airsoft_ddl')
       ORDER BY table_name, grantee, privilege_type`);
    const owners = await restored.query(`
      SELECT tableowner, count(*)::int AS n FROM pg_tables WHERE schemaname='public' GROUP BY tableowner ORDER BY tableowner`);
    await restored.end();

    const diffs = [];
    for (const [table, n] of Object.entries(srcCounts)) {
      const m = restoredCounts[table];
      if (m === undefined) diffs.push({ table, origem: n, restaurado: "ausente" });
      else if (m !== n) diffs.push({ table, origem: n, restaurado: m });
    }
    for (const table of Object.keys(restoredCounts)) {
      if (!(table in srcCounts)) diffs.push({ table, origem: "ausente", restaurado: restoredCounts[table] });
    }

    report[t.key] = {
      dump: dumpFile,
      dumpBytes: bytes.length,
      dumpSha256: sha,
      dumpExit: d.status,
      restoreExit: r.status,
      restoreErrors,
      tabelasOrigem: Object.keys(srcCounts).length,
      tabelasRestauradas: Object.keys(restoredCounts).length,
      linhasTotaisOrigem: Object.values(srcCounts).reduce((a, b) => a + b, 0),
      linhasTotaisRestauradas: Object.values(restoredCounts).reduce((a, b) => a + b, 0),
      divergencias: diffs,
      grantsRestaurados: grants.rows.length,
      amostraGrants: grants.rows.slice(0, 8),
      ownersRestaurados: owners.rows,
      contagemPorTabela: srcCounts,
    };
    report.tablesCompared += Object.keys(srcCounts).length;
    report.mismatches.push(...diffs.map((x) => ({ ...x, alvo: t.key })));
  }
} catch (err) {
  report.errors.push(String(err?.stack ?? err));
} finally {
  if (started) {
    const stop = run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"]);
    report.stopExit = stop.status;
  }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows segura handle */ }
}

report.pass = report.errors.length === 0 && report.mismatches.length === 0;
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
