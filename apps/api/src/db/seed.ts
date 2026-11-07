import type { Db } from "./index.js";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";
import {
  users, customers, categories, brands, products, productVariants,
  productSpecs, inventory, homepageSections,
  fraudRules, orderVolumeLimits, gatewayConfigs, systemSettings, notifications, dailyMetrics,
} from "./schema.js";

/**
 * Seed de desenvolvimento/operação.
 * CATÁLOGO: nenhum dado de concorrente. O catálogo real entra por importação CSV
 * autorizada (painel admin) ou carga fornecida pelo proprietário.
 * Itens de demonstração são marcados explicitamente como DEMO.
 */
const DEMO = "[DEMO]" as const;

export async function seed(db: Db) {
  try {
    // ---------------------------------------------------------------- Fraude
    const existingRules = await db.select().from(fraudRules);
    if (existingRules.length === 0) {
      await db.insert(fraudRules).values([
        { key: "failed_attempts", name: "Múltiplas tentativas de pagamento recusadas", weight: 25, threshold: 3, enabled: true },
        { key: "velocity_customer", name: "Vários pedidos do mesmo cliente em 24h", weight: 20, threshold: 3, enabled: true },
        { key: "high_value", name: "Valor do pedido acima de R$ 2.000", weight: 15, threshold: 200000, enabled: true },
        { key: "address_divergent", name: "Endereço de entrega divergente do histórico", weight: 15, threshold: 0, enabled: true },
        { key: "watchlist_hit", name: "Cliente/e-mail na lista de monitoramento", weight: 40, threshold: 0, enabled: true },
        { key: "no_cpf", name: "Compra sem CPF informado", weight: 10, threshold: 0, enabled: true },
        { key: "new_customer_high_value", name: "Cliente novo com pedido de alto valor", weight: 20, threshold: 150000, enabled: true },
      ]);
      console.log("✅ Default fraud rules seeded");
    }

    // ---------------------------------------------------------------- Usuários (admin dev; trocar credenciais em prod)
    const existingUsers = await db.select().from(users);
    if (existingUsers.length === 0) {
      await db.insert(users).values([
        {
          email: "admin@airsoftamericana.com.br",
          passwordHash: await bcrypt.hash("Admin123!", 10),
          name: "Admin",
          role: "admin",
          active: true,
        },
      ]);
      console.log("✅ Admin user seeded (admin@airsoftamericana.com.br)");
    }

    // ---------------------------------------------------------------- Catálogo DEMO (mínimo, sem dados de concorrente)
    const existingCategories = await db.select().from(categories);
    if (existingCategories.length === 0) {
      const [cat] = await db
        .insert(categories)
        .values([
          { name: `${DEMO} Acessórios`, slug: "demo-acessorios", description: "Categoria de demonstração — substitua pelo catálogo real via importação autorizada.", ageRestricted: false, active: true, position: 0 },
          { name: `${DEMO} Equipamentos`, slug: "demo-equipamentos", description: "Categoria de demonstração — substitua pelo catálogo real via importação autorizada.", ageRestricted: true, active: true, position: 1 },
        ])
        .returning();
      const [brand] = await db
        .insert(brands)
        .values([{ name: `${DEMO} Marca`, slug: "demo-marca", description: "Marca de demonstração.", active: true, position: 0 }])
        .returning();
      if (cat && brand) {
        const demoProducts = [
          { name: `${DEMO} Produto Exemplo A`, slug: "demo-produto-a", sku: "DEMO-SKU-001", priceCents: 19900, stock: 5, categoryId: cat.id, ageRestricted: false },
          { name: `${DEMO} Produto Exemplo B`, slug: "demo-produto-b", sku: "DEMO-SKU-002", priceCents: 34900, stock: 3, categoryId: cat.id, ageRestricted: false },
          { name: `${DEMO} Produto Exemplo C`, slug: "demo-produto-c", sku: "DEMO-SKU-003", priceCents: 49900, stock: 2, categoryId: cat.id, ageRestricted: true },
        ];
        for (const p of demoProducts) {
          const [prod] = await db
            .insert(products)
            .values({
              name: p.name, slug: p.slug, shortDescription: "Item de demonstração.", description: "Produto DEMO para desenvolvimento. Não é item real à venda. Substitua pelo catálogo autorizado.",
              categoryId: p.categoryId, brandId: brand.id, ageRestricted: p.ageRestricted, featured: true, published: true,
            })
            .returning();
          if (!prod) continue;
          const [variant] = await db
            .insert(productVariants)
            .values({ productId: prod.id, sku: p.sku, name: p.name, priceCents: p.priceCents, promoPriceCents: null, weightGrams: 500, active: true })
            .returning();
          if (variant) {
            await db.insert(inventory).values({ variantId: variant.id, physical: p.stock, reserved: 0, minQuantity: 1 });
            await db.insert(productSpecs).values([
              { productId: prod.id, key: "sku", label: "SKU", value: p.sku, position: 0 },
              { productId: prod.id, key: "demo", label: "Aviso", value: "Item de demonstração — não comercial", position: 1 },
            ]);
          }
        }
      }
      console.log("✅ DEMO catalog seeded (sem dados de concorrente)");
    }

    // ---------------------------------------------------------------- CMS
    const existingSections = await db.select().from(homepageSections);
    if (existingSections.length === 0) {
      await db.insert(homepageSections).values([
        { kind: "hero", title: "Campanha principal", subtitle: "Banners administráveis", position: 0, active: true, config: { limit: 5 } },
        { kind: "benefits", title: "Condições comerciais", subtitle: "Regras vindas da configuração da loja", position: 1, active: true, config: {} },
        { kind: "departments", title: "Departamentos", subtitle: "Categorias da loja", position: 2, active: true, config: { limit: 8 } },
        { kind: "featured", title: "Seleção da loja", subtitle: "Produtos escolhidos pelo administrador", position: 3, active: true, config: { limit: 8 } },
        { kind: "institutional", title: "Sobre a Airsoft Americana", subtitle: "Loja física em Americana, entrega para todo o Brasil", position: 4, active: true, config: {} },
        { kind: "newsletter", title: "Receba novidades", subtitle: "Atualizações da loja", position: 5, active: true, config: {} },
      ]);
      console.log("✅ CMS homepage sections seeded");
    }

    // ---------------------------------------------------------------- Configurações comerciais (fonte única; valores do negócio)
    const existingSettings = await db.select().from(systemSettings);
    if (existingSettings.length === 0) {
      await db.insert(systemSettings).values([
        { key: "default_currency", value: { cents: true } },
        { key: "lgpd_consent_default", value: { required: true, age_min: 18 } },
        {
          key: "commercial",
          value: JSON.stringify({
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
          }),
        },
        {
          key: "empresa_dados",
          value: JSON.stringify({
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
          }),
        },
      ]);
      console.log("✅ Default system settings seeded");
    }

    // ---------------------------------------------------------------- Cliente DEMO
    const existingCustomers = await db.select().from(customers);
    if (existingCustomers.length === 0) {
      await db.insert(customers).values([
        {
          name: `${DEMO} Cliente`,
          email: "cliente@demo.com",
          passwordHash: await bcrypt.hash("Cliente123!", 10),
          cpf: "12345678901",
          phone: "19999999999",
        },
      ]);
      console.log("✅ Demo customer seeded (cliente@demo.com)");
    }

    // ---------------------------------------------------------------- Operação
    const existingVolume = await db.select().from(orderVolumeLimits);
    if (existingVolume.length === 0) {
      await db.insert(orderVolumeLimits).values([
        { maxOrdersPerDay: 999999, maxRevenuePerDayCents: 0, maxOrdersPerCustomerPerDay: 999999, maxOrderValueCents: 0, actionWhenExceeded: "bloquear_checkout", enabled: false },
      ]);
      console.log("✅ Default order volume limits seeded");
    }

    const existingGateways = await db.select().from(gatewayConfigs);
    if (existingGateways.length === 0) {
      await db.insert(gatewayConfigs).values([
        { provider: "sandbox", credentialsEncrypted: "", enabled: true, isDefault: true, methods: ["pix", "cartao", "boleto"], captureAfterReview: false, require3ds: false, pixDiscountPercent: 5, updatedByUserId: null },
      ]);
      console.log("✅ Default gateway configs seeded");
    }

    const existingNotifications = await db.select().from(notifications);
    if (existingNotifications.length === 0) {
      await db.insert(notifications).values([
        { kind: "order_created", title: "Novo pedido recebido", body: "Um novo pedido foi realizado", severity: "info" },
        { kind: "low_stock", title: "Estoque baixo", body: "Algum produto está com estoque abaixo do mínimo", severity: "warning" },
      ]);
      console.log("✅ Default notifications seeded");
    }

    const existingMetrics = await db.select().from(dailyMetrics);
    if (existingMetrics.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      await db.insert(dailyMetrics).values({
        day: today, ordersCreated: 0, ordersApproved: 0, ordersCancelled: 0,
        grossCents: 0, refundedCents: 0, chargebacksReceived: 0, chargebackAmountCents: 0, ticketsCents: 0,
      });
      console.log("✅ Default daily metrics seeded");
    }

    console.log("✅ Seed completed (catálogo DEMO; catálogo real via importação CSV autorizada)");
  } catch (err) {
    console.error("❌ Seed failed:", err);
    throw err;
  }
}

export default seed;

// CLI: `npm run db:seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { getDb, closeDb } = await import("./index.js");
  const { migrate } = await import("./migrate.js");
  const db = await getDb();
  await migrate(db);
  await seed(db);
  await closeDb();
}
