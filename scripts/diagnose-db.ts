// language: TypeScript, file: scripts/diagnose-db.ts (v3)
// Diagnóstico READ-ONLY de produção — escopo: AUD-01 (gateway ativo) + contenção (agregados).
// Uso: npx tsx scripts/diagnose-db.ts <arquivo-env>   (o arquivo contém apenas DATABASE_URL)
//
// Garantias:
// 1. Allowlist explícita de colunas — nada além da lista é consultado ou impresso.
// 2. Credencial de conexão deve ser usuário somente leitura (CONNECT/USAGE/SELECT),
//    criado pelo responsável do ambiente; o segredo nunca entra nesta conversa.
// 3. Sessão aberta com default_transaction_read_only=on (defesa adicional, não primária).
// 4. TLS obrigatório com rejectUnauthorized:true em qualquer host não-local; falha
//    de validação interrompe a execução. Hosts locais (127.0.0.1/localhost/::1)
//    são exceção documentada exclusivamente para teste simulado.
// 5. Todas as consultas qualificadas por schema descoberto via information_schema.
// 6. Agregados apenas — nenhum registro individual, PII, credencial, token, URL
//    privada ou metadata. Nenhum INSERT/UPDATE/DELETE/DDL — a sonda de escrita
//    roda em transação descartada (ROLLBACK incondicional).
// 7. DATABASE_URL nunca impressa — nem em erro, nem em relatório (só hostname).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import tls from "node:tls";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Allowlist absoluta de gateway_configs — colunas fora dela NUNCA são consultadas. */
const GATEWAY_ALLOWLIST = [
  "provider",
  "enabled",
  "is_default",
  "environment", // se existir (migration futura)
  "capture_after_review",
  "require3ds",
  "pix_discount_percent",
] as const;
/** Coluna de credencial usada pelos adapters — verificada apenas como booleano. */
const CREDENTIAL_COLUMN = "credentials_encrypted";

function loadEnvFile(file: string): Record<string, string> {
  const txt = readFileSync(file, "utf8");
  const out: Record<string, string> = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const isLocalHost = (h: string) =>
  h === "localhost" || h === "127.0.0.1" || h === "::1";

const isSupabaseHost = (h: string) =>
  h.endsWith(".supabase.com") || h.endsWith(".supabase.co");

async function buildSsl(hostname: string, url: URL): Promise<{ ssl: unknown; mode: string; note?: string }> {
  const sslmode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  if (isLocalHost(hostname)) {
    // Exceção de teste local, documentada: sem TLS na conexão de simulação.
    return { ssl: undefined, mode: sslmode || "local-plain" };
  }
  // Produção: TLS obrigatório, cadeia sempre validada — sem aceitação silenciosa.
  const caPath = process.env.DATABASE_CA_PATH;
  if (caPath) {
    return { ssl: { rejectUnauthorized: true, ca: [readFileSync(caPath, "utf8")] }, mode: sslmode || "require" };
  }
  if (isSupabaseHost(hostname)) {
    // Pooler Supabase: cadeia assinada pela CA raiz da Supabase — mesma fonte
    // usada pelo db/index.ts em produção.
    const mod = (await import(
      pathToFileURL(path.join(ROOT, "apps/api/src/db/supabase-root-ca.ts")).href
    ).catch(() => null)) as { SUPABASE_ROOT_CA_PEM?: string } | null;
    if (!mod?.SUPABASE_ROOT_CA_PEM) {
      throw new Error("CA raiz da Supabase indisponível (supabase-root-ca.ts) — cadeia não pode ser validada; execução interrompida");
    }
    return {
      ssl: { rejectUnauthorized: true, ca: [mod.SUPABASE_ROOT_CA_PEM, ...tls.rootCertificates] },
      mode: sslmode || "require",
      note: "cadeia validada com a CA raiz da Supabase",
    };
  }
  return { ssl: { rejectUnauthorized: true }, mode: sslmode || "require" };
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("[diag] uso: npx tsx scripts/diagnose-db.ts <arquivo-env>");
    process.exit(1);
  }
  const envFile = path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
  const env = loadEnvFile(envFile);
  const rawUrl = env.DATABASE_URL ?? "";
  const url = new URL(rawUrl);
  const hostname = url.hostname;
  console.log(`[diag] arquivo-env: ${path.basename(envFile)} | DATABASE_URL presente: ${Boolean(rawUrl)} | host: ${hostname}`);

  if (!rawUrl) process.exit(1);

  let tlsInfo: Awaited<ReturnType<typeof buildSsl>> | undefined;
  try {
    tlsInfo = await buildSsl(hostname, url);
    if (tlsInfo.note) console.log(`[diag] TLS: ${tlsInfo.note}`);
  } catch (e) {
    console.error("[diag] FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  url.searchParams.delete("sslmode");

  const pool = new Pool({
    connectionString: url.toString(),
    ssl: tlsInfo?.ssl as never,
    max: 1,
    connectionTimeoutMillis: 15_000,
    options: "-c default_transaction_read_only=on",
  });

  const out: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    read_only_guarantees: {
      user_role: "somente leitura (CONNECT/USAGE/SELECT — criada pelo responsável do ambiente)",
      session_default_transaction_read_only: "on",
      write_probe: "executada em transação com ROLLBACK incondicional",
      tls: tlsInfo?.mode ?? "unknown",
    },
    errors: [] as string[],
  };
  const errors = out.errors as string[];

  try {
    // ---------- 0. Identificação da conexão
    const versionRow = (await pool.query("select version()")).rows[0] as { version: string };
    out.pg_version = versionRow.version.split(",").slice(0, 2).join(",");
    out.database = ((await pool.query("select current_database()")).rows[0] as { current_database: string }).current_database;

    // ---------- 1. Descoberta de schema (nunca assumir public)
    // information_schema.tables só expõe tabelas com privilégio de TABELA — um papel
    // com grants por coluna (política correta) não as vê. O catálogo pg_class é
    // legível a qualquer papel e lista a localização real, sem revelar conteúdo.
    const CANDIDATES = ["gateway_configs", "orders", "payments", "schema_migrations", "__drizzle_migrations", "migrations", "db_migrations"];
    const found = (
      await pool.query(
        `select n.nspname as table_schema, c.relname as table_name
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where c.relkind = 'r'
           and c.relname = any($1::text[])
           and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')`,
        [CANDIDATES],
      )
    ).rows as { table_schema: string; table_name: string }[];
    const schemas = [...new Set(found.map((r) => r.table_schema))];
    const schema =
      schemas.includes("public") ? "public" : schemas.length === 1 ? schemas[0] : null;
    if (!schema) {
      errors.push(`schemas ambíguos para tabelas candidatas: ${schemas.join(", ")} — execução interrompida`);
      throw new Error("schema não resolvido");
    }
    out.schema_analisado = schema;

    const q = (sql: string, params: unknown[] = []) => pool.query(sql, params as never);
    const qual = (table: string) => `"${schema}"."${table}"`;

    // ---------- 2. Verificação de privilégios efetivos do papel (Kai §3B)
    // O ambiente deve estar configurado com grant SELECT POR COLUNA. Se o papel
    // tiver qualquer privilégio de escrita, CREATE, ownership, superuser,
    // bypassrls ou grant de tabela inteira, a execução ABORTA — resultado
    // em ambiente fora da política não é confiável.
    const cur = ((await q("select current_user")).rows[0] as { current_user: string }).current_user;
    const violations: string[] = [];
    const privs: Record<string, unknown> = { current_user: cur };

    const roleFlags = (
      await q(`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`)
    ).rows[0] as { rolsuper: boolean; rolbypassrls: boolean };
    privs.rolsuper = roleFlags.rolsuper;
    privs.rolbypassrls = roleFlags.rolbypassrls;
    if (roleFlags.rolsuper) violations.push("papel é superuser");
    if (roleFlags.rolbypassrls) violations.push("papel possui bypassrls");

    privs.role_memberships = (
      await q(
        `with recursive inherited as (
           select m.roleid from pg_auth_members m
           where m.member = (select oid from pg_roles where rolname = current_user)
           union
           select m.roleid from pg_auth_members m
           join inherited i on m.member = i.roleid
         )
         select r.rolname from pg_roles r where r.oid in (select roleid from inherited)`,
      )
    ).rows.map((r) => (r as { rolname: string }).rolname);
    if ((privs.role_memberships as string[]).length > 0) {
      violations.push(`papel membro de outros roles: ${(privs.role_memberships as string[]).join(", ")}`);
    }

    const DATA_TABLES = ["gateway_configs", "orders", "payments"];
    for (const t of DATA_TABLES) {
      for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        if (
          ((await q(`select has_table_privilege(current_user, $1::text, $2::text) as ok`, [`${schema}.${t}`, p]))
            .rows[0] as { ok: boolean }).ok
        ) violations.push(`privilégio de escrita ${p} em ${t}`);
      }
      // grant de tabela inteira veta a política de menor privilégio por coluna
      if (
        ((await q(`select has_table_privilege(current_user, $1::text, 'SELECT') as ok`, [`${schema}.${t}`]))
          .rows[0] as { ok: boolean }).ok
      ) violations.push(`GRANT SELECT de tabela inteira em ${t} — exigido: grant por coluna`);
    }
    if (((await q(`select has_schema_privilege(current_user, $1::text, 'CREATE') as ok`, [schema])).rows[0] as { ok: boolean }).ok) {
      violations.push(`CREATE no schema ${schema}`);
    }
    const owned = (
      await q(
        `select count(*)::int as total from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1 and c.relowner = (select oid from pg_roles where rolname = current_user)`,
        [schema],
      )
    ).rows[0].total;
    privs.tables_owned = owned;
    if (owned > 0) violations.push(`papel é dono de ${owned} objeto(s) no schema`);

    // Matriz EXPLÍCITA has_column_privilege (Kai: visibilidade não substitui a
    // verificação explícita — mantém as duas, inclusive para privilégios herdados)
    // has_column_privilege lança erro se a coluna não existir — coluna inexistente
    // é, por definição, coluna sem privilégio.
    const hasColPriv = async (table: string, col: string): Promise<boolean> => {
      try {
        const r = (await q(`select has_column_privilege(current_user, $1::text, $2::text, 'SELECT') as ok`, [table, col])).rows[0] as { ok: boolean };
        return Boolean(r?.ok);
      } catch {
        return false;
      }
    };
    const REQUIRED_COLS: Record<string, string[]> = {
      orders: ["id", "status"],
      payments: ["order_id", "provider", "status", "provider_transaction_id"],
    };
    privs.column_privileges = { required: {}, forbidden: {} } as Record<string, Record<string, boolean>>;
    for (const [t, cols] of Object.entries(REQUIRED_COLS)) {
      for (const c of cols) {
        const ok = await hasColPriv(`${schema}.${t}`, c);
        (privs.column_privileges.required as Record<string, boolean>)[`${t}.${c}`] = ok;
        if (!ok) violations.push(`coluna necessária ${t}.${c} sem SELECT explícito`);
      }
    }
    const FORBIDDEN_COLS: Record<string, string[]> = {
      gateway_configs: ["id", "methods", "updated_at", "updated_by_user_id", CREDENTIAL_COLUMN],
    };
    for (const [t, cols] of Object.entries(FORBIDDEN_COLS)) {
      for (const c of cols) {
        const ok = await hasColPriv(`${schema}.${t}`, c);
        (privs.column_privileges.forbidden as Record<string, boolean>)[`${t}.${c}`] = ok;
        if (ok) violations.push(`privilégio inesperado sobre coluna proibida ${t}.${c}`);
      }
    }

    // Visibilidade por coluna: qualquer coluna FORA da allowlist visível ao papel
    // implica privilégio sobre ela (information_schema.columns só expõe colunas
    // com algum privilégio) — violação do menor privilégio.
    const COLUMN_ALLOWLIST: Record<string, string[]> = {
      orders: ["id", "status"],
      payments: ["order_id", "provider", "status", "provider_transaction_id"],
      // gateway_configs: tabela base deve estar INVISÍVEL — acesso exclusivo via view
      gateway_configs: [],
    };
    privs.column_visibility = {};
    for (const [t, expected] of Object.entries(COLUMN_ALLOWLIST)) {
      const visible = (
        await q(
          `select column_name from information_schema.columns
           where table_schema = $1 and table_name = $2`,
          [schema, t],
        )
      ).rows.map((r) => (r as { column_name: string }).column_name);
      privs.column_visibility[t] = visible;
      const extra = visible.filter((c) => !expected.includes(c));
      if (extra.length > 0) violations.push(`colunas visíveis fora da allowlist em ${t}: ${extra.join(", ")}`);
      const missing = expected.filter((c) => !visible.includes(c));
      if (missing.length > 0) violations.push(`colunas necessárias não acessíveis em ${t}: ${missing.join(", ")}`);
    }

    // grants de PUBLIC: tabelas E colunas
    privs.public_table_grants = (
      await q(
        `select table_name, privilege_type from information_schema.role_table_grants
         where grantee = 'PUBLIC' and table_schema = $1`,
        [schema],
      )
    ).rows;
    privs.public_column_grants = (
      await q(
        `select table_name, column_name, privilege_type from information_schema.column_privileges
         where grantee = 'PUBLIC' and table_schema = $1`,
        [schema],
      )
    ).rows;
    const publicOnData = [
      ...(privs.public_table_grants as { table_name: string }[]),
      ...(privs.public_column_grants as { table_name: string }[]),
    ].filter((g) => DATA_TABLES.includes(g.table_name));
    if (publicOnData.length > 0) {
      violations.push(`grants de PUBLIC alcançam tabelas de dados: ${[...new Set(publicOnData.map((g) => g.table_name))].join(", ")}`);
    }

    if (violations.length > 0) {
      privs.POLITICA_VIOLADA = violations;
      errors.push(`privilégios efetivos violam a política: ${violations.join("; ")}`);
      throw new Error("execução abortada — ambiente fora da política de menor privilégio");
    }
    out.privilegios_efetivos = privs;

    // ---------- 2b. Sonda de escrita (transação descartada)
    try {
      const probe = await pool.connect();
      try {
        await probe.query("set session default_transaction_read_only = off");
        await probe.query("begin");
        try {
          await probe.query(`create table ${qual("diag_write_probe_v3")} (id int)`);
          // Se chegou aqui, o usuário TEM permissão de escrita — violação da política.
          await probe.query("rollback");
          (out.read_only_guarantees as Record<string, unknown>).write_probe_result =
            "FALHA DA POLÍTICA: CREATE TABLE permitido ao usuário — execute somente com usuário read-only";
          errors.push("usuário de conexão possui privilégio de escrita — resultado NÃO confiança-zero");
        } catch (e) {
          await probe.query("rollback");
          (out.read_only_guarantees as Record<string, unknown>).write_probe_result = "bloqueada pelo banco";
          (out.read_only_guarantees as Record<string, unknown>).write_probe_error =
            e instanceof Error ? e.message.split("\n")[0] : String(e);
        }
      } finally {
        probe.release();
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    // ---------- 3. gateway_configs — acesso EXCLUSIVO via view controlada
    // A view (criada pelo responsável) expõe a allowlist + credentials_present
    // booleano derivado pelo dono da view. O papel NUNCA lê a tabela base.
    const VIEW_NAME = "gateway_audit_status";
    const viewRow = (
      await q(
        `select c.relkind, c.reloptions, r.rolname as owner
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_roles r on r.oid = c.relowner
         where n.nspname = $1 and c.relname = $2`,
        [schema, VIEW_NAME],
      )
    ).rows[0] as { relkind: string; reloptions: string[] | null; owner: string } | undefined;
    if (!viewRow) {
      errors.push(`view "${VIEW_NAME}" não encontrada no schema ${schema} — criação pelo responsável do ambiente (SQL aprovado) antes da execução`);
    } else {
      const lateViolations: string[] = [];
      if (viewRow.relkind !== "v") lateViolations.push(`objeto ${VIEW_NAME} não é uma view`);
      if ((viewRow.reloptions ?? []).some((o) => String(o).includes("security_invoker=true"))) {
        lateViolations.push("view com security_invoker=on — deve rodar com privilégios do dono");
      }
      if (viewRow.owner === cur) {
        lateViolations.push(`o papel de diagnóstico é dono da view ${VIEW_NAME}`);
      } else {
        const ownerFlags = (await q(`select rolsuper from pg_roles where rolname = $1`, [viewRow.owner])).rows[0] as { rolsuper: boolean } | undefined;
        if (ownerFlags?.rolsuper) {
          out.view_owner_note = `dono da view é superuser (${viewRow.owner}) — ressalva registrada; preferível papel controlado com privilégios mínimos`;
        }
      }
      // o papel de diagnóstico não pode alterar a view nem suas dependências
      for (const p of ["INSERT", "UPDATE", "DELETE", "TRIGGER"]) {
        if (
          ((await q(`select has_table_privilege(current_user, $1::text, $2::text) as ok`, [`${schema}.${VIEW_NAME}`, p])).rows[0] as { ok: boolean }).ok
        ) lateViolations.push(`privilégio ${p} na view ${VIEW_NAME}`);
      }

      const viewCols = (
        await q(
          `select column_name from information_schema.columns
           where table_schema = $1 and table_name = $2`,
          [schema, VIEW_NAME],
        )
      ).rows.map((r) => (r as { column_name: string }).column_name);
      const extraInView = viewCols.filter((c) => !GATEWAY_ALLOWLIST.includes(c as never) && c !== "credentials_present");
      if (extraInView.length > 0) lateViolations.push(`view expõe colunas fora da allowlist: ${extraInView.join(", ")}`);

      if (lateViolations.length > 0) {
        out.view_policy_violations = lateViolations;
        errors.push(`política da view violada: ${lateViolations.join("; ")}`);
        throw new Error("execução abortada — política da view violada");
      } else {
        const selected = GATEWAY_ALLOWLIST.filter((c) => viewCols.includes(c));
        const selectList = selected.map((c) => `"${c}"`);
        if (viewCols.includes("credentials_present")) selectList.push(`"credentials_present"`);
        else errors.push("view sem coluna credentials_present — recrie conforme SQL aprovado");
        if (selectList.length > 0) {
          const gwRows = (await q(`select ${selectList.join(", ")} from ${qual(VIEW_NAME)}`)).rows;
          out.gateway_configs = gwRows;
          out.gateway_allowlist_used = [...selected, ...(viewCols.includes("credentials_present") ? ["credentials_present"] : [])];
          if (!viewCols.includes("environment")) {
            (out.gateway_configs_note as string) = "coluna environment não existe na view — ambiente do gateway não configurado no schema (ver AUD-02)";
          }
        }
      }
    }

    // ---------- 4. Colunas de payments/orders (verificar antes de agregar)
    const colNames = async (table: string) =>
      (
        await q(
          `select column_name from information_schema.columns
           where table_schema = $1 and table_name = $2`,
          [schema, table],
        )
      ).rows.map((r) => r.column_name as string);
    const orderCols = await colNames("orders");
    const payCols = await colNames("payments");

    // ---------- 5. Agregados de contenção — apenas contagens
    // Definições (documentadas no relatório):
    // A = pedidos com status 'pagamento_aprovado'
    // B = pagamentos agrupados por provider/status
    // C = pedidos A com pagamento sandbox e NENHUM pagamento de outro provider
    // D = pedidos A sem pagamento de outro provider com referência externa de transação
    //     (não presume que provider != sandbox seja real — mede apenas referência verificável)
    if (orderCols.includes("status")) {
      out.orders_approved = (
        await q(`select count(*)::int as total from ${qual("orders")} where status = 'pagamento_aprovado'`)
      ).rows[0].total;
    } else errors.push("orders.status não encontrada");

    if (payCols.includes("provider") && payCols.includes("status")) {
      out.payments_by_provider_status = (
        await q(`select provider, status, count(*)::int as total from ${qual("payments")} group by 1, 2 order by 3 desc`)
      ).rows;
    } else errors.push("payments.provider/status não encontradas");

    const canJoin = orderCols.includes("status") && payCols.includes("order_id") && orderCols.includes("id");
    if (canJoin) {
      // C: pedidos com PELO MENOS um pagamento, e todos os pagamentos são Sandbox.
      // Pedidos sem pagamento nenhum NÃO entram aqui (métrica E).
      out.orders_approved_exclusively_sandbox = (
        await q(
          `select count(distinct o.id)::int as total
           from ${qual("orders")} o
           where o.status = 'pagamento_aprovado'
             and exists (select 1 from ${qual("payments")} p where p.order_id = o.id)
             and exists (select 1 from ${qual("payments")} p where p.order_id = o.id and p.provider = 'sandbox')
             and not exists (select 1 from ${qual("payments")} p where p.order_id = o.id and p.provider <> 'sandbox')`,
        )
      ).rows[0].total;
    }
    if (canJoin && payCols.includes("provider_transaction_id")) {
      // D: pedidos COM pagamento associado, nenhum deles de outro provider com
      // referência externa preenchida. Pedidos sem pagamento vão para E.
      out.orders_approved_with_payments_without_external_reference = (
        await q(
          `select count(distinct o.id)::int as total
           from ${qual("orders")} o
           where o.status = 'pagamento_aprovado'
             and exists (select 1 from ${qual("payments")} p where p.order_id = o.id)
             and not exists (
               select 1 from ${qual("payments")} p
               where p.order_id = o.id and p.provider <> 'sandbox'
                 and p.provider_transaction_id is not null)`,
        )
      ).rows[0].total;
    }
    if (canJoin) {
      // E: pedidos aprovados sem NENHUM registro de pagamento — categoria própria.
      out.orders_approved_without_any_payment = (
        await q(
          `select count(distinct o.id)::int as total
           from ${qual("orders")} o
           where o.status = 'pagamento_aprovado'
             and not exists (select 1 from ${qual("payments")} p where p.order_id = o.id)`,
        )
      ).rows[0].total;
      (out.metrics_definitions as Record<string, string>) = {
        orders_approved: "pedidos com status pagamento_aprovado",
        payments_by_provider_status: "registros de pagamento por provider/status (não é contagem de pedidos)",
        orders_approved_exclusively_sandbox: "C — pedidos aprovados com pelo menos um pagamento e todos provider='sandbox'",
        orders_approved_with_payments_without_external_reference: "D — pedidos aprovados com pagamento, sem pagamento de outro provider com provider_transaction_id preenchido. NOTA: D não afirma que o pagamento não ocorreu — apenas que a referência externa não foi encontrada conforme a regra definida.",
        orders_approved_without_any_payment: "E — pedidos aprovados sem nenhum registro de pagamento (categoria separada de C e D)",
      };
    } else if (orderCols.includes("status")) {
      errors.push("colunas necessárias para C/D/E ausentes — verifique grants por coluna (orders precisa de id e status)");
    }

    // ---------- 6. Ledger de migrations
    let ledger: string | null = null;
    for (const name of ["schema_migrations", "__drizzle_migrations", "migrations", "db_migrations"]) {
      if (found.some((r) => r.table_name === name && r.table_schema === schema)) { ledger = name; break; }
    }
    out.migrations_ledger = ledger ?? "none_found";
    if (ledger) {
      out.migrations_rows = (await q(`select count(*)::int as total from ${qual(ledger)}`)).rows[0].total;
    }

    // ---------- 7. Inventário de tabelas do schema (contagem, sem conteúdo)
    // pg_class: visível a qualquer papel — information_schema subcontaria sob
    // papel com grants por coluna
    out.public_tables_count = (
      await q(
        `select count(*)::int as total from pg_class c
         where c.relnamespace = (select oid from pg_namespace where nspname = $1)
           and c.relkind = 'r'`,
        [schema],
      )
    ).rows[0].total;
  } catch (e) {
    errors.push(e instanceof Error ? e.message.split("\n")[0] : String(e));
  } finally {
    await pool.end().catch(() => {});
  }

  console.log(JSON.stringify(out, null, 2));
  process.exit(errors.length > 0 && !out.gateway_configs ? 1 : 0);
}

main().catch((e) => {
  console.error("[diag] FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
