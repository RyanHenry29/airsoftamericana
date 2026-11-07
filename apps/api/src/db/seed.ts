import type { Db } from "./index.js";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { cleanText } from "./text.js";
import {
  users, customers, categories, brands, products, productVariants, productImages,
  productSpecs, inventory, banners, homepageSections, relatedProducts,
  fraudRules, orders, orderItems, orderStatusHistory,
  payments, paymentEvents, chargebacks, chargebackEvidence, coupons, promotions,
  orderVolumeLimits, gatewayConfigs, systemSettings, notifications, dailyMetrics, auditLogs
} from "./schema.js";

/**
 * Catálogo real: sale do espelho do gmtatico.com.br com imagem local em
 * apps/store/public/produtos. Preço, SKU e estoque vêm do arquivo — nada aqui
 * é inventado.
 */
type CatalogProduct = {
  slug: string;
  name: string;
  sku: string;
  priceCents: number;
  compareAtCents: number | null;
  promoPriceCents: number | null;
  stock: number;
  weightGrams: number;
  categoryUrl: string;
  brandSlug: string | null;
  imageUrl: string | null;
  images: string[];
};

type Taxonomy = {
  departments: string[];
  categories: { path: string; name: string; slug: string; parent: string | null; depth: number; restricted: boolean }[];
  brands: { path: string; name: string; slug: string }[];
};

type Catalog = {
  source: string;
  generatedAt: string;
  categories: { url: string; name: string }[];
  brands: unknown[];
  products: CatalogProduct[];
};

function readSeedFile<T>(name: string): T {
  const url = new URL(name, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

/** Remove acentos e normaliza para comparação de marca dentro do nome do produto. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/**
 * Taxononomia do espelho: os departments viram categorias raiz, o resto vira
 * subcategorias encadeadas. "marcas" tem as páginas de fabricante como filhas.
 */
const DEPARTMENT_LABELS: Record<string, string> = {
  airsoft: "Airsoft",
  "tiro-esportivo": "Tiro Esportivo",
  upgrades: "Upgrades",
  loadout: "Loadout",
  "life-style": "Life Style",
  aventura: "Aventura",
  promocoes: "Promoções",
  marcas: "Melhores Marcas",
};

/** Categorias raiz com imagem representativa — preenchida com foto real do catálogo. */
const DEPARTMENT_IMAGE_CANDIDATES: Record<string, string[]> = {
  airsoft: ["airsoft/armas-de-airsoft/rifle-de-airsoft-gbbr", "airsoft/armas-de-airsoft/riflesdeairsoft"],
  "life-style": ["life-style/camisetas", "life-style/bermudas"],
  loadout: ["life-style/mochilas", "life-style/camisetas"],
  promocoes: ["airsoft/miras-para-airsoft/red-green-dot", "airsoft/acessorios-para-airsoft"],
  marcas: ["airsoft/armas-de-airsoft/rifle-airsoft-hta", "airsoft/armas-de-airsoft/rifle-de-airsoft-gbbr"],
  "tiro-esportivo": ["tiro-esportivo/carabinas"],
  upgrades: ["upgrades/upgrades-airsoft/pecas-internas-de-airsoft"],
  aventura: ["aventura/camping/lanternas-cyalumes"],
};

export async function seed(db: Db) {
  try {
    const catalog = readSeedFile<Catalog>("./catalog.seed.json");
    const taxonomy = readSeedFile<Taxonomy>("./taxonomy.seed.json");

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

    // ---------------------------------------------------------------- Usuários
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

    // ---------------------------------------------------------------- Categorias
    const existingCategories = await db.select().from(categories);
    if (existingCategories.length === 0) {
      const deptPaths = taxonomy.departments;
      const deptRows = await db
        .insert(categories)
        .values(
          deptPaths.map((path, index) => ({
            name: DEPARTMENT_LABELS[path] ?? path,
            slug: path,
            parentId: null,
            ageRestricted: path === "airsoft" || path === "tiro-esportivo",
            active: true,
            position: index,
            description: "",
          })),
        )
        .returning();

      const idByPath = new Map<string, string>();
      deptRows.forEach((row: { slug: string; id: string }) => idByPath.set(row.slug, row.id));

      // Resolve a hierarquia: o pai precisa existir antes do filho.
      const pending = [...taxonomy.categories].sort((a, b) => a.depth - b.depth);
      for (const cat of pending) {
        const parentId = cat.parent ? idByPath.get(cat.parent) : undefined;
        if (!parentId) continue;
        const [row] = await db
          .insert(categories)
          .values({
            name: cat.name,
            slug: `${cat.parent}-${cat.slug}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
            parentId,
            ageRestricted: cat.restricted,
            active: true,
            position: 0,
            description: "",
          })
          .returning();
        if (row) idByPath.set(cat.path, row.id);
      }
      console.log(`✅ Taxonomy seeded: ${deptRows.length} departamentos, ${pending.length} categorias`);
    }

    // ---------------------------------------------------------------- Higiene de texto
    //
    // O espelho é HTML: nomes e posts chegam escapados ("Muni&ccedil;&atilde;o").
    // Esta passa roda em todo seed de dev e limpa o que já está no banco.
    const categoriasComEntidade = await db
      .select({ id: categories.id, name: categories.name, description: categories.description })
      .from(categories)
      .where(sql`${categories.name} like '%&%' or ${categories.description} like '%&%'`);
    for (const row of categoriasComEntidade) {
      await db
        .update(categories)
        .set({ name: cleanText(row.name), description: cleanText(row.description) })
        .where(sql`${categories.id} = ${row.id}`);
    }

    const cats = await db.select().from(categories);
    const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));

    // Nomes das categorias vêm do arquivo de taxonomia — fonte da importação.
    // O espelho trouxe HTML escapado e caracteres quebrados ("Bon&s" por
    // "Bonês"); o arquivo é a versão limpa, então ela manda.
    for (const cat of taxonomy.categories) {
      const slug = `${cat.parent}-${cat.slug}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      const id = catBySlug.get(slug);
      if (!id) continue;
      await db
        .update(categories)
        .set({ name: cleanText(cat.name) })
        .where(sql`${categories.id} = ${id}`);
    }
    // O slug da categoria carrega o path inteiro com "/" trocado por "-".
    const catIdForPath = (path: string): string | undefined =>
      catBySlug.get(path.replace(/\//g, "-"));

    // ---------------------------------------------------------------- Marcas
    const existingBrands = await db.select().from(brands);
    if (existingBrands.length === 0) {
      await db.insert(brands).values(
        taxonomy.brands.map((b, index) => ({
          name: b.name,
          slug: b.slug,
          position: index,
          active: true,
          description: "",
        })),
      );
      console.log(`✅ Brands seeded: ${taxonomy.brands.length}`);
    }

    const brs = await db.select().from(brands);
    const brandBySlug = new Map(brs.map((b) => [b.slug, b.id]));
    const brandByNormalized = new Map(brs.map((b) => [normalize(b.name), b.id]));

    /** Marca inferida do próprio nome do produto — só casa com marca real do catálogo. */
    function inferBrand(productName: string): string | null {
      const haystack = normalize(productName);
      let found: string | null = null;
      for (const [name, id] of brandByNormalized) {
        if (name.length < 4) continue;
        if (!haystack.includes(name)) continue;
        if (!found || name.length > found.length) found = name;
      }
      return found ? brandByNormalized.get(found)! : null;
    }

    // ---------------------------------------------------------------- Produtos
    const existingProducts = await db.select().from(products);
    if (existingProducts.length === 0) {
      const fallbackCategory = cats.find((c) => !c.parentId)?.id;
      const productIdsBySlug = new Map<string, string>();
      const variantIdsBySlug = new Map<string, string>();
      const featuredSlugs = new Set<string>();

      // O código do fabricante se repete entre produtos diferentes — o SKU
      // interno precisa ser único, o código original vai para a ficha técnica.
      const skuCounts = new Map<string, number>();
      for (const item of catalog.products) {
        const code = item.sku || "SKU";
        skuCounts.set(code, (skuCounts.get(code) ?? 0) + 1);
      }
      const internalSku = (item: CatalogProduct): string => {
        const code = item.sku || "SKU";
        return (skuCounts.get(code) ?? 1) > 1 ? `${code}-${item.slug}`.slice(0, 64) : code;
      };

      for (const [index, item] of catalog.products.entries()) {
        const path = (item.categoryUrl ?? "").replace(/^\/|\/$/g, "");
        const categoryId = catIdForPath(path) ?? fallbackCategory;
        if (!categoryId) continue;

        const brandId = item.brandSlug ? brandBySlug.get(item.brandSlug) ?? null : inferBrand(item.name);
        const listPrice = item.compareAtCents ?? item.priceCents;
        const promoPrice = item.promoPriceCents ?? (item.compareAtCents ? item.priceCents : null);
        const category = cats.find((c) => c.id === categoryId);
        const description = [
          `${item.name}.`,
          `Categoria: ${category?.name ?? "Airsoft"}.`,
          `Código do fabricante: ${item.sku}.`,
          item.weightGrams > 0 ? `Peso aproximado: ${item.weightGrams} g.` : null,
          "Consulte a ficha técnica para especificações completas.",
        ]
          .filter(Boolean)
          .join(" ");

        const [product] = await db
          .insert(products)
          .values({
            name: item.name,
            slug: item.slug,
            shortDescription: "",
            description,
            categoryId,
            brandId,
            ageRestricted: category?.ageRestricted ?? false,
            featured: false,
            published: true,
          })
          .returning();
        if (!product) continue;
        productIdsBySlug.set(item.slug, product.id);

        const [variant] = await db
          .insert(productVariants)
          .values({
            productId: product.id,
            sku: internalSku(item),
            name: item.name,
            priceCents: listPrice,
            promoPriceCents: promoPrice,
            weightGrams: item.weightGrams ?? 0,
            active: true,
          })
          .returning();
        if (!variant) continue;
        variantIdsBySlug.set(item.slug, variant.id);

        await db.insert(inventory).values({
          variantId: variant.id,
          physical: Math.max(0, item.stock ?? 0),
          reserved: 0,
          minQuantity: 2,
        });

        if (item.images?.length) {
          await db.insert(productImages).values(
            item.images.map((url, position) => ({
              productId: product.id,
              url,
              alt: item.name,
              kind: "image",
              position,
            })),
          );
        }

        await db.insert(productSpecs).values([
          { productId: product.id, key: "sku", label: "Código do fabricante", value: item.sku || "—", position: 0 },
          { productId: product.id, key: "categoria", label: "Categoria", value: category?.name ?? "Airsoft", position: 1 },
          ...(brandId
            ? [{ productId: product.id, key: "marca", label: "Marca", value: brs.find((b) => b.id === brandId)?.name ?? "", position: 2 }]
            : []),
          { productId: product.id, key: "estoque", label: "Estoque", value: `${Math.max(0, item.stock ?? 0)} un.`, position: 3 },
          ...(item.weightGrams > 0
            ? [{ productId: product.id, key: "peso", label: "Peso", value: `${item.weightGrams} g`, position: 4 }]
            : []),
        ]);

        // Destaques: quem tem preço promocional ou compare-at sai na vitrine.
        if (promoPrice !== null && item.stock > 0 && featuredSlugs.size < 12) {
          featuredSlugs.add(item.slug);
          await db.update(products).set({ featured: true }).where(sql`${products.id} = ${product.id}`);
        }
        if (index % 40 === 0) {
          console.log(`   … catálogo ${index + 1}/${catalog.products.length}`);
        }
      }

      // Relacionados: mesma categoria, produto mais próximo no índice.
      const relatedSeeds: { productId: string; relatedProductId: string }[] = [];
      const byCategory = new Map<string, string[]>();
      for (const [slug, id] of productIdsBySlug) {
        const item = catalog.products.find((p) => p.slug === slug);
        if (!item) continue;
        const key = (item.categoryUrl ?? "").replace(/^\/|\/$/g, "");
        byCategory.set(key, [...(byCategory.get(key) ?? []), id]);
      }
      for (const [key, ids] of byCategory) {
        if (ids.length < 2) continue;
        for (let i = 0; i < ids.length; i++) {
          const next = ids[(i + 1) % ids.length];
          if (next !== ids[i]) relatedSeeds.push({ productId: ids[i]!, relatedProductId: next! });
        }
        void key;
      }
      if (relatedSeeds.length > 0) {
        await db
          .insert(relatedProducts)
          .values(relatedSeeds.map((r, i) => ({ ...r, position: i })))
          .onConflictDoNothing();
      }

      console.log(`✅ Catalog seeded: ${productIdsBySlug.size} produtos, ${variantIdsBySlug.size} variantes`);
    }

    // ---------------------------------------------------------------- CMS: banners e seções
    const existingBanners = await db.select().from(banners);
    if (existingBanners.length === 0) {
      const heroCandidates = [
        {
          paths: ["airsoft/armas-de-airsoft/rifle-de-airsoft-gbbr", "airsoft/armas-de-airsoft/riflesdeairsoft", "airsoft/armas-de-airsoft/rifle-airsoft-hta"],
          title: "RIFLES DE AIRSOFT",
          subtitle: "AEG, GBBR, HTA, Spring e AEP — escolha pelo sistema de tiro.",
          eyebrow: "Airsoft",
          cta: "COMPRAR AGORA",
          link: "/catalogo?categoria=airsoft",
        },
        {
          paths: ["airsoft/miras-para-airsoft", "airsoft/miras-para-airsoft/red-green-dot", "airsoft/miras-para-airsoft/lunetas"],
          title: "MIRAS E ÓPTICA",
          subtitle: "Red dot, green dot, lunetas e montagens para o seu setup.",
          eyebrow: "Miras",
          cta: "VER MIRAS",
          link: "/catalogo?categoria=airsoft/miras-para-airsoft",
        },
        {
          paths: ["airsoft/equipamentos-taticos", "life-style/camisetas", "airsoft/comunicacao/radios"],
          title: "EQUIPAMENTO COMPLETO",
          subtitle: "Proteção, vestuário e comunicação para entrar em campo pronto.",
          eyebrow: "Loadout",
          cta: "VER EQUIPAMENTOS",
          link: "/catalogo",
        },
      ];
      const bannerRows: (typeof banners.$inferInsert)[] = [];
      for (const [index, candidate] of heroCandidates.entries()) {
        const product = candidate.paths
          .map((path) => catalog.products.find((p) => (p.categoryUrl ?? "").replace(/^\/|\/$/g, "") === path))
          .find((p) => p && p.images?.length);
        const image = product?.images?.[0] ?? null;
        if (!image) continue;
        bannerRows.push({
          title: candidate.title,
          subtitle: candidate.subtitle,
          eyebrow: candidate.eyebrow,
          ctaLabel: candidate.cta,
          imageDesktop: image,
          imageMobile: image,
          link: candidate.link,
          kind: "hero",
          active: true,
          position: index,
        });
      }
      if (bannerRows.length > 0) await db.insert(banners).values(bannerRows);

      const existingSections = await db.select().from(homepageSections);
      if (existingSections.length === 0) {
        await db.insert(homepageSections).values([
          { kind: "hero", title: "Campanha principal", subtitle: "Carrossel de banners administráveis", position: 0, active: true, config: { limit: 5 } },
          { kind: "benefits", title: "Condições comerciais", subtitle: "Desconto no PIX, frete por CEP, compra protegida", position: 1, active: true, config: {} },
          { kind: "departments", title: "Departamentos", subtitle: "Escolha pelo sistema de tiro", position: 2, active: true, config: { limit: 8 } },
          { kind: "news", title: "Novidades", subtitle: "Produtos cadastrados recentemente", position: 3, active: true, config: { limit: 8 } },
          { kind: "featured", title: "Seleção da loja", subtitle: "Produtos escolhidos pelo administrador", position: 4, active: true, config: { limit: 8 } },
          { kind: "bestsellers", title: "Mais vendidos", subtitle: "Ordenado por vendas reais", position: 5, active: true, config: { limit: 8 } },
          { kind: "promo", title: "Promoções", subtitle: "Preços promocionais ativos", position: 6, active: true, config: { limit: 8 } },
          { kind: "brands", title: "Melhores marcas", subtitle: "Fabricantes que trabalham com a gente", position: 7, active: true, config: { limit: 24 } },
          { kind: "institutional", title: "Sobre a Airsoft Americana", subtitle: "Loja física em Americana, entrega para todo o Brasil", position: 8, active: true, config: {} },
          { kind: "newsletter", title: "Receba novidades", subtitle: "Drops, reposição e ofertas", position: 9, active: true, config: {} },
        ]);
      }
      console.log("✅ CMS seeded: banners e seções da homepage");
    }

    // ---------------------------------------------------------------- Imagens por departamento
    const catRows = await db.select().from(categories);
    const rootCats = catRows.filter((c) => !c.parentId);
    for (const root of rootCats) {
      const candidates = DEPARTMENT_IMAGE_CANDIDATES[root.slug] ?? [];
      let url: string | undefined;
      for (const candidatePath of candidates) {
        const candidateProduct = catalog.products.find(
          (p) => (p.categoryUrl ?? "").replace(/^\/|\/$/g, "") === candidatePath && p.images?.length,
        );
        if (candidateProduct?.images?.[0]) {
          url = candidateProduct.images[0];
          break;
        }
      }
      if (!url) continue;
      await db.update(categories).set({ imageUrl: url }).where(sql`${categories.id} = ${root.id}`);
    }

    // ---------------------------------------------------------------- Configurações comerciais
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


    // ---------------------------------------------------------------- Cliente demo
    const existingCustomers = await db.select().from(customers);
    if (existingCustomers.length === 0) {
      await db.insert(customers).values([
        {
          name: "Cliente Demo",
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

    const existingPromotions = await db.select().from(promotions);
    if (existingPromotions.length === 0) {
      await db.insert(promotions).values([
        { name: "Desconto PIX", kind: "percentual", content: JSON.stringify({ percentual: 5 }), active: true },
      ]);
      console.log("✅ Default promotions seeded");
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
        day: today,
        ordersCreated: 0,
        ordersApproved: 0,
        ordersCancelled: 0,
        grossCents: 0,
        refundedCents: 0,
        chargebacksReceived: 0,
        chargebackAmountCents: 0,
        ticketsCents: 0,
      });
      console.log("✅ Default daily metrics seeded");
    }

    console.log("✅ Seed completed");
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
