// language: Node ESM, file: scripts/diagnose-prod-db.mjs
// Diagnóstico seguro do PostgreSQL de produção
// Retorna apenas metadados do banco e estado das migrations, sem expor credenciais

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import tls from "node:tls";

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
console.log(`[diag] env file: ${file} | has DATABASE_URL: ${Boolean(url)} | host: ${url ? new URL(url).hostname : "-"}`);

if (!url) {
  console.error("[diag] DATABASE_URL não encontrada");
  process.exit(1);
}

const u = new URL(url);
const mode = (u.searchParams.get("sslmode") ?? "").toLowerCase();
u.searchParams.delete("sslmode");

let ssl;
if (url.hostname.endsWith(".supabase.co")) {
  if (mode === "disable") ssl = false;
  else {
    const { SUPABASE_ROOT_CA_PEM } = await import(
      path.join(ROOT, "apps/api/src/db/supabase-root-ca.ts").replace(/\\/g, "/")
    ).catch(() => ({ SUPABASE_ROOT_CA_PEM: undefined }));
    ssl = SUPABASE_ROOT_CA_PEM ? { ca: [SUPABASE_ROOT_CA_PEM, ...tls.rootCertificates] } : true;
  }
} else if (mode === "disable") ssl = false;
else if (mode === "prefer" || mode === "allow") ssl = undefined;
else ssl = { rejectUnauthorized: mode !== "require" };

const cleanUrl = (() => {
  try { const u = new URL(url); u.searchParams.delete("sslmode"); return u.toString(); } catch { return url; }
})();

const pool = new Pool({ connectionString: cleanUrl, ssl, connectionTimeoutMillis: 15000, max: 1 });

async function query(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function main() {
  const result = {
    timestamp: new Date().toISOString(),
    driver: "pg",
    orm: "drizzle",
    connection: { established: false },
    database: {},
    pgVersion: null,
    migrations: { applied: 0, pending: 0, details: [] },
    tables: { essential: {}, product_image_uploads: false },
    schemaVersion: null,
    environment: process.env.NODE_ENV ?? "unknown",
    errors: []
  };

  try {
    // 1. Conexão e versão
    const version = await pool.query("select version()");
    const versionStr = version.rows[0].version;
    environment.pgVersion = versionStr;
    environment.connection.established = true;
    console.log(`[diag] Connected: ${versionStr.slice(0, 60)}...`);

    // 2. Nome do banco
    const dbName = await pool.query("select current_database()");
    environment.database.name = dbName.rows[0].current_database;
    console.log(`[diag] Database: ${environment.database.name}`);

    // 3. Verificar se usa PGlite ou PostgreSQL
    const isPglite = versionStr.toLowerCase().includes("pglite");
    environment.driver = isPglite ? "pglite" : "postgres";

    // 4. Tabelas essenciais
    const essentialTables = [
      "users", "sessions", "customers", "products", "product_variants",
      "orders", "order_items", "payments", "inventory", "categories",
      "brands", "banners", "homepage_sections", "system_settings",
      "orders", "order_items", "payments", "inventory",
      "product_variants", "product_images", "product_image_uploads",
      "categories", "brands", "orders", "order_status_history",
      "payments", "payment_events", "chargebacks", "shipments",
      "fraud_assessments", "fraud_rules", "watchlist",
      "audit_logs", "webhooks", "gateway_configs",
      "product_image_uploads", "product_specs", "related_products",
      "compatible_products", "coupons", "promotions",
      "order_volume_limits", "daily_metrics", "notifications",
      "support_tickets", "newsletter_subscribers", "blog_posts",
      "ai_conversations", "ai_messages", "ai_uploads", "ai_drafts",
      "support_tickets", "support_messages", "audit_logs",
      "product_specs", "related_products", "compatible_products",
      "product_change_history", "idempotency_keys"
    ];

    for (const table of essentialTables) {
      try {
        const r = await query(`select 1 from "${table}" limit 1`);
        environment.tables.essential[table] = true;
      } catch (e) {
        environment.tables.essential[table] = false;
      }
    }

    // 5. product_image_uploads específico
    try {
      const r = await query(`select count(*) as count from "product_image_uploads"`);
      environment.tables.product_image_uploads = { exists: true, count: parseInt(r.rows[0].count) };
    } catch (e) {
      environment.tables.product_image_uploads = { exists: false, error: e.message };
    }

    // 5. Verificar se existe tabela de controle de migrations (drizzle ou custom)
    let migrationTable = null;
    for (const name of ["__drizzle_migrations", "migrations", "schema_migrations", "schema_version", "db_migrations"]) {
      try {
        const r = await pool.query(`select 1 from "${name}" limit 1`);
        migrationTable = name;
        break;
      } catch (e) {
        // não existe
      }
    }
    environment.migrations.table = migrationTable;

    if (migrationTable) {
      const rows = await pool.query(`select * from "${migrationTable}" order by 1`);
      environment.migrations.applied = rows.rowCount;
      environment.migrations.details = rows.rows;
    } else {
      environment.migrations.table = "none_found";
    }

    // 5. Comparar com migrations esperadas (contar tabelas criadas no migrate.ts)
    // Como as migrations são idempotentes (IF NOT EXISTS), contar tabelas criadas
    const expectedTables = [
      "users", "sessions", "mfa_recovery_codes", "webauthn_credentials", "admin_invites",
      "auth_lockouts", "customers", "customer_addresses", "customer_avatars",
      "password_resets", "brands", "categories", "products", "product_variants",
      "product_images", "product_image_uploads", "product_specs", "related_products",
      "compatible_products", "banners", "homepage_sections", "inventory",
      "inventory_movements", "carts", "cart_items", "orders", "order_items",
      "order_status_history", "payments", "payment_events", "refunds",
      "gateway_configs", "chargebacks", "chargeback_evidence", "fraud_assessments",
      "fraud_rules", "watchlist", "fraud_review_events", "shipments",
      "shipping_events", "promotions", "order_volume_limits", "notifications",
      "daily_metrics", "product_change_history", "idempotency_keys",
      "related_products", "compatible_products", "coupons", "promotions",
      "newsletter_subscribers", "banners", "banner_images", "homepage_sections",
      "product_specs", "related_products", "compatible_products",
      "product_change_history", "idempotency_keys", "coupons", "promotions",
      "newsletter_subscribers", "banners", "banner_images", "homepage_sections",
      "product_specs", "related_products", "compatible_products",
      "product_change_history", "idempotency_keys", "webhooks",
      "system_settings", "fraud_assessments", "fraud_rules", "watchlist",
      "fraud_review_events", "shipments", "shipping_events",
      "promotions", "order_volume_limits", "daily_metrics",
      "notifications", "support_tickets", "newsletter_subscribers",
      "blog_posts", "ai_conversations", "ai_messages", "ai_uploads", "ai_drafts",
      "support_tickets", "support_messages", "audit_logs",
      "coupons", "promotions", "webhooks", "system_settings",
      "order_volume_limits", "banners", "banner_images", "homepage_sections"
    ];

    let existingCount = 0;
    for (const table of expectedTables) {
      if (environment.tables.essential[table] === true) existingCount++;
    }
    environment.migrations.applied = existingCount;
    environment.migrations.expected = expectedTables.length;
    environment.migrations.pending = expectedTables.length - existingCount;

    // 6. Verificar schema version (se existir)
    try {
      const sv = await pool.query("select * from schema_version limit 1");
      if (sv.rowCount > 0) environment.schemaVersion = sv.rows[0];
    } catch (e) {
      // não existe
    }

    // 7. Verificar se é PGlite ou PostgreSQL real
    try {
      const r = await query("select pg_backend_pid()");
      environment.connection.backendPid = r.rows[0].pg_backend_pid;
    } catch (e) {
      // pode ser PGlite
    }

  } catch (e) {
    environment.errors.push(e.message);
    console.error("[diag] ERROR:", e.message);
  } finally {
    await pool.end().catch(() => {});
  }

  return environment;
}

main().then(result => {
  console.log("\n=== DIAGNÓSTICO DO BANCO ===");
  console.log(JSON.stringify(result, null, 2));
  
  // Classificação
  console.log("\n=== CLASSIFICAÇÃO ===");
  const classification = {
    driver: result.driver ? "COMPROVADA" : "NÃO COMPROVADA",
    connection: result.connection.established ? "COMPROVADA" : "NÃO COMPROVADA",
    database: result.database.name ? "COMPROVADA" : "NÃO COMPROVADA",
    pgVersion: result.pgVersion ? "COMPROVADA" : "NÃO COMPROVADA",
    migrationsTable: result.migrations.table !== "none_found" ? "COMPROVADA" : "NÃO COMPROVADA",
    migrationsApplied: result.migrations.applied > 0 ? "COMPROVADA" : "NÃO COMPROVADA",
    essentialTables: Object.values(result.tables.essential).filter(Boolean).length === Object.keys(result.tables.essential).length ? "COMPROVADA" : "PARCIAL",
    productImageUploads: result.tables.product_image_uploads?.exists ? "COMPROVADA" : "NÃO COMPROVADA",
    pgVersion: result.pgVersion ? "COMPROVADA" : "NÃO COMPROVADA",
    migrationsApplied: result.migrations.applied > 0 ? "COMPROVADA" : "NÃO COMPROVADA",
    pendingMigrations: result.migrations.pending === 0 ? "COMPROVADA" : "NÃO COMPROVADA",
  };
  console.log(JSON.stringify(classification, null, 2));
  
  process.exit(0);
}).catch(e => {
  console.error("[diag] FATAL:", e);
  process.exit(1);
});