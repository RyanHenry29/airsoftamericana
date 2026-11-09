// language: TS, file: apps/api/src/cli/bootstrap-prod.ts, target: Postgres (Supabase)
/**
 * Bootstrap de PRODUÇÃO — roda por banco novo (ou a cada deploy de esquema),
 * conectado como papel DDL (`airsoft_ddl`): migrações + dados reais +
 * grants do papel de runtime (`airsoft_app`).
 *
 * NADA de itens [DEMO]: sem categorias/marcas/produtos de demonstração e sem
 * cliente fake. O catálogo real entra depois pela importação CSV do painel.
 * O que é sembrado aqui é dado real de operação: regras de fraude, seções de
 * CMS, condições comerciais do negócio, taxonomia do menu e marcas.
 *
 * Uso:
 *   DATABASE_URL=postgresql://airsoft_ddl:SENHA@db.REF.supabase.co:5432/postgres?sslmode=require \
 *     npm run db:bootstrap -w @airsoft/api
 *
 * Idempotente: bloco a bloco, só insere se a tabela estiver vazia.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { Db } from "../db/index.js";
import {
  users, categories, brands, homepageSections, fraudRules,
  orderVolumeLimits, gatewayConfigs, systemSettings, dailyMetrics,
} from "../db/schema.js";
import { departments, brands as brandCatalog, type TaxonomyNode } from "../db/taxonomy.seed.js";

async function isEmpty(db: Db, table: AnyPgTable): Promise<boolean> {
  const rows = await db.select().from(table).limit(1);
  return rows.length === 0;
}

/** Árvore de categorias real (departamento → categoria → subcategoria). */
async function insertTaxonomy(db: Db): Promise<number> {
  let count = 0;
  async function walk(nodes: TaxonomyNode[], parentId: string | null, position: number): Promise<void> {
    let pos = position;
    for (const node of nodes) {
      const [row] = await db
        .insert(categories)
        .values({
          name: node.name,
          slug: node.slug,
          description: "",
          parentId,
          ageRestricted: node.ageRestricted ?? false,
          active: true,
          position: pos,
        })
        .onConflictDoNothing({ target: categories.slug })
        .returning();
      count += 1;
      pos += 1;
      if (node.children?.length && row) {
        await walk(node.children, row.id, 0);
      }
    }
  }
  await walk(departments, null, 0);
  return count;
}

async function seedProductionData(db: Db): Promise<{ adminPassword?: string }> {
  const out: { adminPassword?: string } = {};

  // ------------------------------------------------------------ Regras de fraude
  if (await isEmpty(db, fraudRules)) {
    await db.insert(fraudRules).values([
      { key: "failed_attempts", name: "Múltiplas tentativas de pagamento recusadas", weight: 25, threshold: 3, enabled: true },
      { key: "velocity_customer", name: "Vários pedidos do mesmo cliente em 24h", weight: 20, threshold: 3, enabled: true },
      { key: "high_value", name: "Valor do pedido acima de R$ 2.000", weight: 15, threshold: 200000, enabled: true },
      { key: "address_divergent", name: "Endereço de entrega divergente do histórico", weight: 15, threshold: 0, enabled: true },
      { key: "watchlist_hit", name: "Cliente/e-mail na lista de monitoramento", weight: 40, threshold: 0, enabled: true },
      { key: "no_cpf", name: "Compra sem CPF informado", weight: 10, threshold: 0, enabled: true },
      { key: "new_customer_high_value", name: "Cliente novo com pedido de alto valor", weight: 20, threshold: 150000, enabled: true },
    ]);
    console.log("  + 7 regras de fraude");
  }

  // ------------------------------------------------------------ Admin (senha gerada)
  if (await isEmpty(db, users)) {
    const password = crypto.randomBytes(18).toString("base64url");
    await db.insert(users).values([
      {
        email: "admin@airsoftamericana.com.br",
        passwordHash: await bcrypt.hash(password, 12),
        name: "Admin",
        role: "admin",
        active: true,
      },
    ]);
    out.adminPassword = password;
    console.log("  + usuário admin criado (senha gerada)");
  }

  // ------------------------------------------------------------ CMS da home
  if (await isEmpty(db, homepageSections)) {
    await db.insert(homepageSections).values([
      { kind: "hero", title: "Campanha principal", subtitle: "Banners administráveis", position: 0, active: true, config: { limit: 5 } },
      { kind: "benefits", title: "Condições comerciais", subtitle: "Regras vindas da configuração da loja", position: 1, active: true, config: {} },
      { kind: "departments", title: "Departamentos", subtitle: "Categorias da loja", position: 2, active: true, config: { limit: 8 } },
      { kind: "featured", title: "Seleção da loja", subtitle: "Produtos escolhidos pelo administrador", position: 3, active: true, config: { limit: 8 } },
      { kind: "institutional", title: "Sobre a Airsoft Americana", subtitle: "Loja física em Americana, entrega para todo o Brasil", position: 4, active: true, config: {} },
      { kind: "newsletter", title: "Receba novidades", subtitle: "Atualizações da loja", position: 5, active: true, config: {} },
    ]);
    console.log("  + 6 seções de CMS da home");
  }

  // ------------------------------------------------------------ Configurações
  if (await isEmpty(db, systemSettings)) {
    await db.insert(systemSettings).values([
      { key: "default_currency", value: { cents: true } },
      { key: "lgpd_consent_default", value: { required: true, age_min: 18 } },
      {
        key: "commercial",
        value: {
          pix_discount_percent: 7,
          installments: 3,
          installment_interest_free: true,
          min_installment_cents: 9000,
          free_shipping_from_cents: 79900,
          shipping_carriers: ["Correios - PAC", "Correios - SEDEX"],
          whatsapp: "5519984504992",
          email: "contato@airsoftamericana.com.br",
          address: {
            street: "Rua Celinda Antônia Quaino Santa Rosa, 157",
            district: "Jardim Luciane",
            city: "Americana",
            state: "SP",
            zip: "13477-225",
          },
          service_hours: "Segunda a sexta 09h às 18h · Sábado 09h às 12h · Domingo fechado",
          social: { instagram: "airsoft_americana", whatsapp: "5519984504992" },
          announcement: "ENTREGA PARA TODO O BRASIL",
        },
      },
      {
        key: "empresa_dados",
        value: {
          nome_fantasia: "Airsoft Americana",
          razao_social: "Welyngton Codogno",
          natureza_juridica: "Empresário Individual",
          porte: "Microempresa (ME)",
          regime_tributario: "Simples Nacional",
          cnpj: "27.019.653/0001-79",
          fundacao: "02/02/2017",
          endereco: "Rua Celinda Antônia Quaino Santa Rosa, 157, Jardim Luciane, Americana-SP, CEP 13477-225",
          email_contato: "contato@airsoftamericana.com.br",
          telefone_principal: "(19) 98450-4992",
          whatsapp: "5519984504992",
          telefone_secundario: "(19) 99150-4992",
        },
      },
    ]);
    console.log("  + configurações comerciais e dados da empresa");
  }

  // ------------------------------------------------------------ Operação
  if (await isEmpty(db, orderVolumeLimits)) {
    await db.insert(orderVolumeLimits).values([
      { maxOrdersPerDay: 999999, maxRevenuePerDayCents: 0, maxOrdersPerCustomerPerDay: 999999, maxOrderValueCents: 0, actionWhenExceeded: "bloquear_checkout", enabled: false },
    ]);
    console.log("  + limites de volume de pedidos (desativados)");
  }

  if (await isEmpty(db, gatewayConfigs)) {
    await db.insert(gatewayConfigs).values([
      { provider: "sandbox", credentialsEncrypted: "", enabled: true, isDefault: true, methods: ["pix", "cartao", "boleto"], captureAfterReview: false, require3ds: false, pixDiscountPercent: 5, updatedByUserId: null },
    ]);
    console.log("  + gateway padrão sandbox (trocar no painel)");
  }

  if (await isEmpty(db, dailyMetrics)) {
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(dailyMetrics).values({
      day: today, ordersCreated: 0, ordersApproved: 0, ordersCancelled: 0,
      grossCents: 0, refundedCents: 0, chargebacksReceived: 0, chargebackAmountCents: 0, ticketsCents: 0,
    });
    console.log("  + métricas do dia (zeros)");
  }

  // ------------------------------------------------------------ Catálogo estrutural
  if (await isEmpty(db, categories)) {
    const n = await insertTaxonomy(db);
    console.log(`  + taxonomia real do menu (${n} categorias)`);
  }

  if (await isEmpty(db, brands)) {
    await db.insert(brands).values(
      brandCatalog.map((b, i) => ({ name: b.name, slug: b.slug, description: "", active: true, position: i })),
    );
    console.log(`  + ${brandCatalog.length} marcas de referência`);
  }

  return out;
}

/** Grants do papel de runtime — DML completo, exceto UPDATE/DELETE em audit_logs. */
async function grantRuntimeRole(db: Db): Promise<void> {
  await db.execute(sql.raw(`
    GRANT USAGE ON SCHEMA public TO airsoft_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO airsoft_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO airsoft_app;
    REVOKE UPDATE, DELETE ON TABLE audit_logs FROM airsoft_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO airsoft_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO airsoft_app;
  `));
  const res = await db.execute(sql.raw(`
    SELECT has_table_privilege('airsoft_app', 'audit_logs', 'UPDATE') AS can_update,
           has_table_privilege('airsoft_app', 'audit_logs', 'DELETE') AS can_delete
  `));
  const rows = (res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
  const row = rows[0] as Record<string, unknown>;
  const canUpdate = row.can_update === true || row.can_update === "t";
  const canDelete = row.can_delete === true || row.can_delete === "t";
  if (canUpdate || canDelete) {
    throw new Error("airsoft_app ainda tem UPDATE/DELETE em audit_logs — a API de produção recusaria subir.");
  }
  console.log("  + papel airsoft_app: DML concedido, audit_logs append-only confirmado");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL ausente — aponte para o Postgres de produção (papel airsoft_ddl).");
    process.exit(1);
  }
  console.log("== Bootstrap de produção ==");
  const { getDb, closeDb } = await import("../db/index.js");
  const { migrate } = await import("../db/migrate.js");
  const db = await getDb();

  console.log("[1/3] Migrações...");
  await migrate(db);
  console.log("  esquema no ar");

  console.log("[2/3] Dados reais (sem [DEMO])...");
  const { adminPassword } = await seedProductionData(db);

  console.log("[3/3] Grants do papel de runtime...");
  await grantRuntimeRole(db);

  console.log("== Bootstrap concluído ==");
  if (adminPassword) {
    console.log("");
    console.log("  CREDENCIAIS DO PAINEL (guarde — exibida só uma vez):");
    console.log("    e-mail: admin@airsoftamericana.com.br");
    console.log(`    senha:  ${adminPassword}`);
    console.log("");
  } else {
    console.log("  admin já existia — credenciais não alteradas.");
  }

  await closeDb();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("❌ Bootstrap falhou:", err);
    process.exit(1);
  });
}
