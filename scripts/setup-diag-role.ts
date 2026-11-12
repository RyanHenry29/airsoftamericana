// language: TypeScript, file: scripts/setup-diag-role.ts
// Criação do papel diag_audit + view gateway_audit_status conforme SQL aprovado (v3.2).
// Idempotente e ADITIVO — nada é revogado, nada é alterado, nada é apagado.
// A senha (32 bytes crypto) é escrita APENAS em apps/api/.env.diag — nunca impressa.
// Reversibilidade: DROP VIEW public.gateway_audit_status; DROP ROLE diag_audit;

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import tls from "node:tls";
import crypto from "node:crypto";
import { Client } from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvUrl(file: string): URL {
  const txt = readFileSync(path.join(ROOT, file), "utf8");
  const m = /DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/.exec(txt);
  if (!m) throw new Error(`DATABASE_URL ausente em ${file}`);
  return new URL(m[1].trim().replace(/^postgres(ql)?:\/\//, "postgresql://"));
}

async function main(): Promise<void> {
  const base = loadEnvUrl("apps/api/.env.prod");
  // sslmode da URL sobrescreveria o objeto ssl com a CA — removido (TLS vem do objeto)
  base.searchParams.delete("sslmode");
  // TLS estrito: mesma CA usada pelo diagnose (Supabase) — erro explícito se falhar
  let caPem: string | undefined;
  try {
    const mod = (await import(
      pathToFileURL(path.join(ROOT, "apps/api/src/db/supabase-root-ca.ts")).href
    )) as { SUPABASE_ROOT_CA_PEM?: string };
    caPem = mod.SUPABASE_ROOT_CA_PEM;
  } catch (e) {
    throw new Error(`import da CA Supabase falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ssl = { rejectUnauthorized: true, ca: [caPem as string, ...tls.rootCertificates] };

  const pw = crypto.randomBytes(32).toString("base64url");
  const client = new Client({ connectionString: base.toString(), ssl: ssl as never });
  await client.connect();

  const log: string[] = [];
  const db = (await client.query("select current_database() as d")).rows[0].d as string;
  log.push(`banco: ${db} | host: ${base.hostname}`);

  const me = (await client.query("select current_user as u, current_setting('is_superuser') as s")).rows[0];
  log.push(`conectado como: ${me.u} | superuser: ${me.s}`);

  // 1. Papel — idempotente, sem herança, sem criação de objetos
  const roleSql = `
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'diag_audit') then
        execute format('create role diag_audit login password %L nosuperuser nocreatedb nocreaterole noinherit nobypassrls', $pw$${pw}$pw$);
      else
        execute format('alter role diag_audit login password %L nosuperuser nocreatedb nocreaterole noinherit nobypassrls', $pw$${pw}$pw$);
      end if;
    end $$;`;
  await client.query(roleSql);
  log.push("papel diag_audit: criado/atualizado (login, nosuperuser, nocreaterole, noinherit, nobypassrls)");

  // 2. Grants mínimos — apenas as colunas aprovadas; NADA de revoke em outros papéis
  await client.query(`grant connect on database "${db}" to diag_audit`);
  await client.query(`grant usage on schema public to diag_audit`);
  await client.query(`grant select (id, status) on public.orders to diag_audit`);
  await client.query(`grant select (order_id, provider, status, provider_transaction_id) on public.payments to diag_audit`);
  log.push("grants por coluna: orders(id,status), payments(order_id,provider,status,provider_transaction_id)");

  // 3. View controlada — presença de credencial como booleano; NENHUM grant na tabela base
  await client.query(`
    drop view if exists public.gateway_audit_status;
    create view public.gateway_audit_status as
      select provider, enabled, is_default,
             (credentials_encrypted is not null) as credentials_present,
             capture_after_review, require3ds, pix_discount_percent
      from public.gateway_configs;`);
  await client.query(`grant select on public.gateway_audit_status to diag_audit`);
  log.push("view gateway_audit_status: recriada e concedida; tabela base gateway_configs SEM grant");

  // 4. Verificação do papel — o que a política do diagnose vai checar
  const check = (await client.query(`
    select r.rolname, r.rolsuper, r.rolinherit, r.rolbypassrls,
           (select count(*) from pg_auth_members m where m.member = r.oid)::int as memberships,
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relowner = r.oid)::int as owned_objects
    from pg_roles r where r.rolname = 'diag_audit'`)).rows[0];
  log.push(`verificação do papel: superuser=${check.rolsuper} inherit=${check.rolinherit} bypassrls=${check.rolbypassrls} memberships=${check.memberships} owned=${check.owned_objects}`);

  const grants = (await client.query(`
    select table_name, column_name, privilege_type from information_schema.column_privileges
    where grantee = 'diag_audit' order by table_name, column_name`)).rows;
  log.push(`colunas concedidas (${grants.length}): ${grants.map((g: { table_name: string; column_name: string }) => `${g.table_name}.${g.column_name}`).join(", ")}`);

  await client.end();

  // 5. Conexão do diagnóstico — escrita local, senha nunca impressa
  const diagUrl = new URL(base.toString());
  diagUrl.username = "diag_audit";
  diagUrl.password = pw;
  diagUrl.searchParams.set("sslmode", "require");
  writeFileSync(path.join(ROOT, "apps/api/.env.diag"), `DATABASE_URL=${diagUrl.toString()}\n`, "utf8");
  log.push("apps/api/.env.diag: escrito (somente leitura; senha não impressa nesta conversa)");

  console.log(log.join("\n"));
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  console.error("limitação: se falhar por falta de CREATEROLE, a única intervenção necessária é um admin do Supabase executar o SQL aprovado (v3.2).");
  process.exit(1);
});
