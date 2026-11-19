// language: JS (ESM), file: scripts/check-role-privileges.mjs, target: PostgreSQL 17
// Comprova o isolamento DDL/runtime no banco: o papel runtime (airsoft_app)
// pode fazer DML, não pode criar objetos e não pode alterar/apagar audit_logs.
// Uso: node scripts/check-role-privileges.mjs "<DATABASE_URL_RUNTIME>"
import pg from "pg";

const url = process.argv[2];
if (!url) {
  console.error("uso: node scripts/check-role-privileges.mjs <DATABASE_URL>");
  process.exit(2);
}

// node-postgres deixa o sslmode da connection string vencer o objeto ssl.
// Montamos a config na mão para forçar rejectUnauthorized:false (cert self-signed do Supabase).
const u = new URL(url);
const client = new pg.Client({
  host: u.hostname,
  port: Number(u.port || 5432),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, "") || "postgres",
  ssl: { rejectUnauthorized: false },
});

const checks = [
  ["pode conectar", `SELECT true AS ok`],
  ["sem CREATE no schema public", `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS ok`],
  ["tem USAGE no schema public", `SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS ok`],
  ["SELECT em products", `SELECT has_table_privilege(current_user, 'public.products', 'SELECT') AS ok`],
  ["INSERT em products", `SELECT has_table_privilege(current_user, 'public.products', 'INSERT') AS ok`],
  ["UPDATE em products", `SELECT has_table_privilege(current_user, 'public.products', 'UPDATE') AS ok`],
  ["DELETE em products", `SELECT has_table_privilege(current_user, 'public.products', 'DELETE') AS ok`],
  ["SELECT em orders", `SELECT has_table_privilege(current_user, 'public.orders', 'SELECT') AS ok`],
  ["INSERT em orders", `SELECT has_table_privilege(current_user, 'public.orders', 'INSERT') AS ok`],
  ["UPDATE em orders", `SELECT has_table_privilege(current_user, 'public.orders', 'UPDATE') AS ok`],
  ["SELECT em inventory", `SELECT has_table_privilege(current_user, 'public.inventory', 'SELECT') AS ok`],
  ["UPDATE em inventory", `SELECT has_table_privilege(current_user, 'public.inventory', 'UPDATE') AS ok`],
  ["INSERT em audit_logs", `SELECT has_table_privilege(current_user, 'public.audit_logs', 'INSERT') AS ok`],
  ["UPDATE em audit_logs (deve ser false)", `SELECT has_table_privilege(current_user, 'public.audit_logs', 'UPDATE') AS ok`],
  ["DELETE em audit_logs (deve ser false)", `SELECT has_table_privilege(current_user, 'public.audit_logs', 'DELETE') AS ok`],
  ["UPDATE em payments (runtime grava status do pagamento)", `SELECT has_table_privilege(current_user, 'public.payments', 'UPDATE') AS ok`],
  ["SELECT em chargebacks", `SELECT has_table_privilege(current_user, 'public.chargebacks', 'SELECT') AS ok`],
  ["sem papel de membro de pg_write_all_data", `SELECT pg_has_role(current_user, 'pg_write_all_data', 'MEMBER') AS ok`],
];

const negative = [
  ["CREATE TABLE deve falhar", `CREATE TABLE public._probe_runtime_ddl (id int)`],
  ["UPDATE audit_logs deve falhar", `UPDATE public.audit_logs SET action = 'probe' WHERE false`],
  ["DELETE audit_logs deve falhar", `DELETE FROM public.audit_logs WHERE false`],
];

const expectedFalse = new Set([
  "UPDATE em audit_logs (deve ser false)",
  "DELETE em audit_logs (deve ser false)",
  "sem CREATE no schema public",
  "sem papel de membro de pg_write_all_data",
]);

const out = { user: null, checks: [], negatives: [], failed: [] };

try {
  await client.connect();
  const u = await client.query("SELECT current_user, session_user, version()");
  out.user = { current_user: u.rows[0].current_user, session_user: u.rows[0].session_user, version: u.rows[0].version };

  for (const [name, sql] of checks) {
    try {
      const r = await client.query(sql);
      const value = r.rows[0]?.ok;
      const shouldBeFalse = expectedFalse.has(name);
      const pass = shouldBeFalse ? value === false : value === true;
      out.checks.push({ name, value, pass });
      if (!pass) out.failed.push(name);
    } catch (err) {
      out.checks.push({ name, error: err.message, pass: false });
      out.failed.push(name);
    }
  }

  for (const [name, sql] of negative) {
    try {
      await client.query(sql);
      out.negatives.push({ name, error: null, pass: false });
      out.failed.push(name);
    } catch (err) {
      out.negatives.push({ name, error: err.message, pass: true });
    }
  }
} finally {
  await client.end().catch(() => {});
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.failed.length === 0 ? 0 : 1);
