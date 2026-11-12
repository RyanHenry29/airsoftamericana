// language: Node ESM, file: scripts/probe-prod-db.mjs, target: Node 20+
// Probe de diagnóstico: abre o DATABASE_URL de apps/api/.env.prod e roda as 3
// queries que falham em produção (categories/banners/system_settings), imprimindo
// o erro original do PG (code + message). Nunca imprime a URL nem credenciais.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const out = {};
  const txt = readFileSync(path.join(ROOT, "apps", "api", file), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const file = process.argv[2] ?? ".env.prod";
const env = loadEnv(file);
const url = env.DATABASE_URL ?? "";
console.log(`env file: ${file} | has DATABASE_URL: ${Boolean(url)} | host: ${url ? new URL(url).hostname : "-"}`);

if (!url) process.exit(1);

const { Pool } = await import("pg");
const tls = await import("node:tls");

let ssl;
try {
  const u = new URL(url);
  const mode = (u.searchParams.get("sslmode") ?? "").toLowerCase();
  u.searchParams.delete("sslmode");
  if (mode === "disable") ssl = false;
  else if (u.hostname.endsWith(".supabase.co")) {
    const { SUPABASE_ROOT_CA_PEM } = await import(
      path.join(ROOT, "apps/api/src/db/supabase-root-ca.ts").replace(/\\/g, "/")
    ).catch(() => ({ SUPABASE_ROOT_CA_PEM: undefined }));
    ssl = SUPABASE_ROOT_CA_PEM ? { ca: [SUPABASE_ROOT_CA_PEM, ...tls.rootCertificates] } : true;
  } else if (mode === "prefer" || mode === "allow") ssl = undefined;
  else ssl = { rejectUnauthorized: mode !== "require" };
} catch {
  /* url inválida deixa pg decidir */
}

const cleanUrl = (() => {
  try { const u = new URL(url); u.searchParams.delete("sslmode"); return u.toString(); } catch { return url; }
})();

const pool = new Pool({ connectionString: cleanUrl, ssl, connectionTimeoutMillis: 15000, max: 1 });

const probes = [
  ["categories", `select "id", "parent_id", "name", "slug" from "categories" where "categories"."active" = $1 order by "categories"."position" asc, "categories"."name" asc`, [true]],
  ["banners", `select * from "banners" where "active" = $1 order by "position" asc`, [true]],
  ["system_settings", `select * from "system_settings" limit 1`, []],
];

let failed = false;
try {
  const version = await pool.query("select version()");
  console.log(`connected: ${version.rows[0].version.slice(0, 60)}...`);
} catch (error) {
  failed = true;
  console.log(`CONNECT FAILED | ${error.code ?? ""} | ${error.message}`);
}
if (!failed) {
  for (const [name, sql, params] of probes) {
    try {
      const r = await pool.query(sql, params);
      console.log(`OK ${name} | rows=${r.rowCount}`);
    } catch (error) {
      failed = true;
      console.log(`FAIL ${name} | code=${error.code ?? ""} | ${error.message} | cause=${error.cause?.message ?? "-"}`);
    }
  }
}
await pool.end().catch(() => {});
process.exit(failed ? 2 : 0);
