// language: JavaScript, file: scripts/test-diagnose-local.mjs
// Teste simulado do diagnose-db.ts v3 contra Postgres embutido REAL (binÃ¡rios oficiais).
// Prova: (1) agregados corretos, (2) allowlist exclui credenciais, (3) escrita bloqueada
// pelo banco para o papel read-only, (4) papel nÃ£o lÃª tabelas fora do escopo.
// Nenhum dado real de produÃ§Ã£o â€” tudo sintÃ©tico.

import EmbeddedPostgres from "embedded-postgres";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rmRf = (p) => fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });


const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "apps", "api", ".pg-diag-sim");
const ENV_FILE = path.join(ROOT, "apps", "api", ".env.diag-local");
const PORT = 55432;

async function main() {
  console.log("=== 1. Subindo Postgres embutido (simulaÃ§Ã£o) ===");
  rmRf(DATA_DIR);
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  let exitCode = 0;
  try {
    const admin = pg.getPgClient();
    await admin.connect();
    await admin.query("create database sim");
    await admin.end();

    const db = pg.getPgClient("sim");
    await db.connect();

    console.log("=== 2. Schema simulado + dados sintÃ©ticos ===");
    await db.query(`
      create table gateway_configs (
        id uuid default gen_random_uuid(),
        provider varchar(32) not null unique,
        credentials_encrypted text,
        enabled boolean not null default false,
        is_default boolean not null default false,
        methods jsonb not null default '["pix","cartao","boleto"]',
        capture_after_review boolean not null default false,
        require3ds boolean not null default false,
        pix_discount_percent integer not null default 0,
        updated_at timestamptz not null default now(),
        updated_by_user_id uuid
      );
      create table orders (id uuid primary key default gen_random_uuid(), status varchar(40) not null);
      create table payments (
        id uuid primary key default gen_random_uuid(),
        order_id uuid references orders(id),
        provider varchar(32), status varchar(40), provider_transaction_id varchar(120)
      );
      -- decoy: tabela com PII que o script NUNCA consulta e o papel NÃƒO pode ler
      create table customers_pii (name text, cpf text);
      insert into customers_pii values ('Cliente SintÃ©tico', '000.000.000-00');

      insert into gateway_configs (provider, credentials_encrypted, enabled, is_default) values
        ('sandbox', null, true, true),
        ('mercadopago', 'AES-256-GCM::CIPHERTEXT-NUNCA-IMPRIMIR', false, false),
        ('cielo', 'AES-256-GCM::CIPHERTEXT-2', false, false);

      -- 9 pedidos: 6 aprovados (3 sandbox-only, 1 mercadopago com tx real,
      -- 1 mercadopago sem tx, 1 sem pagamento nenhum) + 3 em outros status
      insert into orders (status) values
        ('pagamento_aprovado'),('pagamento_aprovado'),('pagamento_aprovado'),
        ('pagamento_aprovado'),('pagamento_aprovado'),('pagamento_aprovado'),
        ('aguardando_pagamento'),('cancelado'),('em_analise_antifraude');
      insert into payments (order_id, provider, status, provider_transaction_id)
      select id,
        case when rn <= 3 then 'sandbox' else 'mercadopago' end,
        case when rn <= 3 then 'aprovado' else 'pendente' end,
        case when rn <= 3 then 'sbx_' || left(id::text, 8)
             when rn = 4 then 'MP-REF-12345'
             else null end
      from (select id, row_number() over (order by id) as rn
            from orders where status = 'pagamento_aprovado') ranked
      where rn <= 5;

      create role diag_ro login password 'diag_ro_local_only';
      grant connect on database sim to diag_ro;
      grant usage on schema public to diag_ro;
      -- grants POR COLUNA, SEM credentials_encrypted (v3.2 — Kai §1)
      grant select (id, status) on orders to diag_ro;
      grant select (order_id, provider, status, provider_transaction_id) on payments to diag_ro;
      -- view controlada: presença de credencial como booleano, derivada pelo dono
      create view gateway_audit_status as
        select provider, enabled, is_default,
               (credentials_encrypted is not null) as credentials_present,
               capture_after_review, require3ds, pix_discount_percent
        from gateway_configs;
      grant select on gateway_audit_status to diag_ro;
      -- NENHUM grant na tabela base gateway_configs
      -- sem grant em customers_pii; sem CREATE no schema (PG15+ já revoga)
      -- sem grant em customers_pii; sem CREATE no schema (PG15+ jÃ¡ revoga)
    `);
    console.log("schema + seed ok (6 aprovados: 3 sandbox-only, 1 MP com tx, 1 MP sem tx, 1 sem pagamento)");

    console.log("=== 3. Executando diagnose-db.ts como diag_ro ===");
    fs.writeFileSync(ENV_FILE, "DATABASE_URL=postgres://diag_ro:diag_ro_local_only@127.0.0.1:55432/sim?sslmode=disable\n");
    const run = spawnSync("npx", ["tsx", "scripts/diagnose-db.ts", "apps/api/.env.diag-local"], {
      cwd: ROOT, encoding: "utf8", shell: true, timeout: 120_000,
    });
    console.log("--- stdout do script ---");
    console.log(run.stdout);
    if (run.stderr) console.log("--- stderr ---\n" + run.stderr);
    console.log(`exit code: ${run.status}`);

    // ValidaÃ§Ã£o programÃ¡tica do resultado
    const jsonStart = run.stdout.indexOf("{");
    const report = JSON.parse(run.stdout.slice(jsonStart, run.stdout.lastIndexOf("}") + 1));
    const checks = [];
    const chk = (name, ok, got) => checks.push(`${ok ? "PASS" : "FAIL"} ${name} (obtido: ${JSON.stringify(got)})`);

    chk("orders_approved == 6", report.orders_approved === 6, report.orders_approved);
    chk("orders_approved_exclusively_sandbox == 3 (C)", report.orders_approved_exclusively_sandbox === 3, report.orders_approved_exclusively_sandbox);
    chk("orders_approved_with_payments_without_external_reference == 4 (D)", report.orders_approved_with_payments_without_external_reference === 4, report.orders_approved_with_payments_without_external_reference);
    chk("orders_approved_without_any_payment == 1 (E)", report.orders_approved_without_any_payment === 1, report.orders_approved_without_any_payment);
    const priv = report.privilegios_efetivos ?? {};
    chk("privilégios efetivos sem violação", !priv.POLITICA_VIOLADA, priv.POLITICA_VIOLADA ?? "ok");
    chk("papel sem membership", (priv.role_memberships ?? []).length === 0, priv.role_memberships);
    chk("papel não é dono de objetos", priv.tables_owned === 0, priv.tables_owned);
    chk("nenhum grant de PUBLIC", (priv.public_grants ?? []).length === 0, priv.public_grants);
    chk("coluna credencial INACESSÍVEL na tabela base (matriz explícita)", priv.column_privileges?.forbidden?.["gateway_configs.credentials_encrypted"] === false, priv.column_privileges?.forbidden);
    chk("colunas requeridas com SELECT explícito", priv.column_privileges?.required?.["orders.id"] === true && priv.column_privileges?.required?.["payments.provider_transaction_id"] === true, priv.column_privileges?.required);
    chk("dono da view registrado (superuser = ressalva)", /superuser/.test(String(priv.view_owner_note ?? report.view_owner_note ?? "")), report.view_owner_note);
    chk("colunas visíveis = allowlist exata (orders)", JSON.stringify((priv.column_visibility?.orders ?? []).sort()) === JSON.stringify(["id", "status"]), priv.column_visibility?.orders);
    chk("colunas visíveis = allowlist exata (payments)", JSON.stringify((priv.column_visibility?.payments ?? []).sort()) === JSON.stringify(["order_id", "provider", "provider_transaction_id", "status"]), priv.column_visibility?.payments);
    chk("gateway_configs base invisível", (priv.column_visibility?.gateway_configs ?? []).length === 0, priv.column_visibility?.gateway_configs);
    chk("write_probe bloqueada pelo banco", /bloqueada pelo banco/.test(JSON.stringify(report.read_only_guarantees)), report.read_only_guarantees?.write_probe_result);
    const gw = report.gateway_configs ?? [];
    const gwStr = JSON.stringify(gw);
    chk("gateway_configs NUNCA contém ciphertext", !gwStr.includes("CIPHERTEXT") && !gwStr.includes("credentials_encrypted"), gwStr);
    chk("credentials_present booleano via view", gw.every?.((r) => typeof r.credentials_present === "boolean"), Object.keys(gw[0] ?? {}));
    chk("allowlist usada (via view + booleano)", JSON.stringify(report.gateway_allowlist_used) === JSON.stringify(["provider", "enabled", "is_default", "capture_after_review", "require3ds", "pix_discount_percent", "credentials_present"]), report.gateway_allowlist_used);
    chk("nota de environment ausente", /environment/.test(JSON.stringify(report.gateway_configs_note ?? "")), report.gateway_configs_note);
    chk("migrations_ledger none_found", report.migrations_ledger === "none_found", report.migrations_ledger);
    chk("sem PII no relatÃ³rio", !run.stdout.includes("Cliente SintÃ©tico") && !run.stdout.includes("000.000.000-00"), "-");
    chk("DATABASE_URL nunca impressa", !run.stdout.includes("diag_ro_local_only"), "-");

    console.log("=== 4. Provas negativas (role read-only contra tabelas fora do escopo) ===");
    const { Client } = await import("pg");
    const ro = new Client({ host: "127.0.0.1", port: PORT, user: "diag_ro", password: "diag_ro_local_only", database: "sim" });
    await ro.connect();
    try {
      await ro.query("select * from customers_pii");
      chk("SELECT em customers_pii", false, "permitido (FALHA DA POLÃTICA)");
    } catch (e) {
      chk("SELECT em customers_pii", /permission denied/i.test(e.message), e.message.split("\n")[0]);
    }
    try {
      await ro.query("insert into orders (status) values ('x')");
      chk("INSERT em orders", false, "permitido (FALHA DA POLÃTICA)");
    } catch (e) {
      chk("INSERT em orders", /permission denied|read-only/i.test(e.message), e.message.split("\n")[0]);
    }
    try {
      await ro.query("select credentials_encrypted from gateway_configs");
      chk("SELECT credentials_encrypted na tabela base", false, "permitido (FALHA DA POLÍTICA)");
    } catch (e) {
      chk("SELECT credentials_encrypted na tabela base", /permission denied/i.test(e.message), e.message.split("\n")[0]);
    }
    try {
      await ro.query("select methods from gateway_configs");
      chk("SELECT methods (fora da allowlist)", false, "permitido (FALHA DA POLÍTICA)");
    } catch (e) {
      chk("SELECT methods (fora da allowlist)", /permission denied/i.test(e.message), e.message.split("\n")[0]);
    }
    try {
      await ro.query("select updated_at from gateway_configs");
      chk("SELECT updated_at (fora da allowlist)", false, "permitido (FALHA DA POLÍTICA)");
    } catch (e) {
      chk("SELECT updated_at (fora da allowlist)", /permission denied/i.test(e.message), e.message.split("\n")[0]);
    }
    await ro.end();

    console.log("=== 6. Cenário negativo: grant de tabela inteira deve ABORTAR a execução ===");
    const admin2 = pg.getPgClient();
    await admin2.connect();
    await admin2.query("create database sim_wide");
    await admin2.end();
    const wide = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "sim_wide" });
    await wide.connect();
    await wide.query(`
      create table gateway_configs (provider varchar(32) not null, credentials_encrypted text, enabled boolean default false, is_default boolean default false, capture_after_review boolean default false, require3ds boolean default false, pix_discount_percent integer default 0);
      create table orders (id uuid primary key default gen_random_uuid(), status varchar(40) not null);
      create table payments (id uuid primary key default gen_random_uuid(), order_id uuid, provider varchar(32), status varchar(40), provider_transaction_id varchar(120));
      insert into gateway_configs (provider) values ('sandbox');
      create role diag_wide login password 'diag_wide_local_only';
      grant connect on database sim_wide to diag_wide;
      grant usage on schema public to diag_wide;
      grant select on gateway_configs, orders, payments to diag_wide; -- VIOLAÇÃO: tabela inteira
    `);
    await wide.end();
    fs.writeFileSync(ENV_FILE, "DATABASE_URL=postgres://diag_wide:diag_wide_local_only@127.0.0.1:55432/sim_wide?sslmode=disable\n");
    const runWide = spawnSync("npx", ["tsx", "scripts/diagnose-db.ts", "apps/api/.env.diag-local"], {
      cwd: ROOT, encoding: "utf8", shell: true, timeout: 120_000,
    });
    chk("script ABORTA com grant de tabela inteira", runWide.status !== 0 && /execução abortada|POLITICA_VIOLADA/i.test(runWide.stdout + runWide.stderr), `exit=${runWide.status}`);
    chk("violação identificada no relatório", /GRANT SELECT de tabela inteira/i.test(runWide.stdout), "-");

    console.log("=== 7. Cenário negativo: grant de PUBLIC em tabela de dados deve ABORTAR ===");
    const admin3 = pg.getPgClient();
    await admin3.connect();
    await admin3.query("create database sim_public");
    await admin3.end();
    const pub = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "sim_public" });
    await pub.connect();
    await pub.query(`
      create table gateway_configs (provider varchar(32) not null, enabled boolean default false, is_default boolean default false, capture_after_review boolean default false, require3ds boolean default false, pix_discount_percent integer default 0, credentials_encrypted text);
      create table orders (id uuid primary key default gen_random_uuid(), status varchar(40) not null);
      create table payments (id uuid primary key default gen_random_uuid(), order_id uuid, provider varchar(32), status varchar(40), provider_transaction_id varchar(120));
      create role diag_pub login password 'diag_pub_local_only';
      grant connect on database sim_public to diag_pub;
      grant usage on schema public to diag_pub;
      grant select (id, status) on orders to diag_pub;
      grant select (order_id, provider, status, provider_transaction_id) on payments to diag_pub;
      grant select on payments to public; -- VIOLAÇÃO: PUBLIC alcança tabela de dados
    `);
    await pub.end();
    fs.writeFileSync(ENV_FILE, "DATABASE_URL=postgres://diag_pub:diag_pub_local_only@127.0.0.1:55432/sim_public?sslmode=disable\n");
    const runPub = spawnSync("npx", ["tsx", "scripts/diagnose-db.ts", "apps/api/.env.diag-local"], {
      cwd: ROOT, encoding: "utf8", shell: true, timeout: 120_000,
    });
    chk("script ABORTA com grant de PUBLIC", runPub.status !== 0 && /execução abortada|POLITICA_VIOLADA/i.test(runPub.stdout + runPub.stderr), `exit=${runPub.status}`);
    chk("violação PUBLIC identificada", /grants de PUBLIC alcançam/i.test(runPub.stdout), "-");

    console.log("=== 8. Cenário negativo: membership TRANSITIVO em papel privilegiado deve ABORTAR ===");
    const admin4 = pg.getPgClient();
    await admin4.connect();
    await admin4.query("create database sim_member");
    await admin4.end();
    const mem = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "sim_member" });
    await mem.connect();
    await mem.query(`
      create table gateway_configs (provider varchar(32) not null, enabled boolean default false, is_default boolean default false, capture_after_review boolean default false, require3ds boolean default false, pix_discount_percent integer default 0, credentials_encrypted text);
      create table orders (id uuid primary key default gen_random_uuid(), status varchar(40) not null);
      create table payments (id uuid primary key default gen_random_uuid(), order_id uuid, provider varchar(32), status varchar(40), provider_transaction_id varchar(120));
      create role diag_helper noinherit;
      grant create on schema public to diag_helper; -- privilégio de escrita via membership
      create role diag_mid noinherit;
      grant diag_helper to diag_mid;
      create role diag_ro4 login password 'diag_ro4_local_only';
      grant diag_mid to diag_ro4; -- membership INDIRETO: diag_ro4 -> diag_mid -> diag_helper
      -- grants legítimos por coluna (para o abort ocorrer na checagem de membership,
      -- não na descoberta de schema)
      grant select (id, status) on orders to diag_ro4;
      grant select (order_id, provider, status, provider_transaction_id) on payments to diag_ro4;
    `);
    await mem.end();
    fs.writeFileSync(ENV_FILE, "DATABASE_URL=postgres://diag_ro4:diag_ro4_local_only@127.0.0.1:55432/sim_member?sslmode=disable\n");
    const runMem = spawnSync("npx", ["tsx", "scripts/diagnose-db.ts", "apps/api/.env.diag-local"], {
      cwd: ROOT, encoding: "utf8", shell: true, timeout: 120_000,
    });
    chk("script ABORTA com membership transitivo", runMem.status !== 0 && /execução abortada|POLITICA_VIOLADA/i.test(runMem.stdout + runMem.stderr), `exit=${runMem.status}`);
    chk("membership indireto detectado", /membro de outros roles/i.test(runMem.stdout), "-");
    // abort ANTES da primeira consulta de dados: nenhum dado coletado
    const memStart = runMem.stdout.indexOf("{");
    const memReport = JSON.parse(runMem.stdout.slice(memStart, runMem.stdout.lastIndexOf("}") + 1));
    chk("abort antes de coletar gateway_configs", !("gateway_configs" in memReport), Object.keys(memReport));

    console.log("=== 9. Cenário negativo: view sob posse do papel de diagnóstico deve ABORTAR ===");
    const admin5 = pg.getPgClient();
    await admin5.connect();
    await admin5.query("create database sim_owned");
    await admin5.end();
    const ownedDb = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "postgres", database: "sim_owned" });
    await ownedDb.connect();
    await ownedDb.query(`
      create table gateway_configs (provider varchar(32) not null, enabled boolean default false, is_default boolean default false, capture_after_review boolean default false, require3ds boolean default false, pix_discount_percent integer default 0, credentials_encrypted text);
      create table orders (id uuid primary key default gen_random_uuid(), status varchar(40) not null);
      create table payments (id uuid primary key default gen_random_uuid(), order_id uuid, provider varchar(32), status varchar(40), provider_transaction_id varchar(120));
      create role diag_ro5 login password 'diag_ro5_local_only';
      grant connect on database sim_owned to diag_ro5;
      grant usage on schema public to diag_ro5;
      grant select (id, status) on orders to diag_ro5;
      grant select (order_id, provider, status, provider_transaction_id) on payments to diag_ro5;
      create view gateway_audit_status as
        select provider, enabled, is_default,
               (credentials_encrypted is not null) as credentials_present,
               capture_after_review, require3ds, pix_discount_percent
        from gateway_configs;
      alter view gateway_audit_status owner to diag_ro5; -- VIOLAÇÃO: diagnóstico é dono da view
    `);
    await ownedDb.end();
    fs.writeFileSync(ENV_FILE, "DATABASE_URL=postgres://diag_ro5:diag_ro5_local_only@127.0.0.1:55432/sim_owned?sslmode=disable\n");
    const runOwned = spawnSync("npx", ["tsx", "scripts/diagnose-db.ts", "apps/api/.env.diag-local"], {
      cwd: ROOT, encoding: "utf8", shell: true, timeout: 120_000,
    });
    chk("script ABORTA quando o papel é dono da view", runOwned.status !== 0 && /execução abortada|don[o] da view|dono de 1 objeto/i.test(runOwned.stdout), `exit=${runOwned.status}`);

    console.log("=== 5. Resumo das provas ===");
    for (const c of checks) console.log(c);
    if (checks.some((c) => c.startsWith("FAIL"))) exitCode = 1;

    await db.end();
  } finally {
    await pg.stop().catch(() => {});
    try { rmRf(DATA_DIR); } catch (e) { console.log("aviso: diretorio de simulacao nao removido nesta rodada:", e.code); }
    try { rmRf(ENV_FILE); } catch (e) { console.log("aviso: env de teste nao removido:", e.code); }
    console.log("=== limpeza: Postgres parado, diretÃ³rio e env de teste removidos ===");
  }
  process.exitCode = exitCode;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
