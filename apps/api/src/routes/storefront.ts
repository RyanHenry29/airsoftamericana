import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { listProducts, getProductBySlug, type SortKey } from "../services/catalog.js";
import { buildHome, getCommercialSettings, searchSuggestions } from "../services/homepage.js";
import { getCompanyData } from "../services/settings.js";
import { registerBlogRoutes } from "./blog.js";
import {
  childrenOf,
  countProductsByCategory,
  findBySlug,
  loadTaxonomy,
  subtreeOf,
} from "../services/taxonomy.js";

const SORTS: SortKey[] = [
  "featured_first",
  "news",
  "price_asc",
  "price_desc",
  "name_asc",
  "bestsellers",
];

function intParam(value: string | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Rotas públicas da loja. Tudo que a vitrine mostra sai daqui — preço,
 * estoque e disponibilidade são sempre recalculados no servidor.
 */
export function registerStorefrontRoutes(app: FastifyInstance, db: Db): void {
  // ---------------------------------------------------------------- Home
  app.get("/api/store/home", async (_request, reply) => {
    reply.send(await buildHome(db));
  });

  // ---------------------------------------------------------------- Catálogo
  app.get("/api/store/products", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const page = Math.max(1, intParam(q.page) ?? 1);
    const limit = Math.min(60, Math.max(1, intParam(q.limit) ?? 24));
    const sort = (SORTS.includes(q.sort as SortKey) ? q.sort : "featured_first") as SortKey;

    const condRaw = (q.condicao ?? q.condition ?? "").trim();
    const condicao = condRaw === "novo" || condRaw === "usado" || condRaw === "seminovo" ? condRaw : undefined;
    const result = await listProducts(db, {
      category: q.categoria ?? q.category,
      brand: q.brand,
      q: q.q,
      sort,
      page,
      limit,
      minPriceCents: intParam(q.minPrice),
      maxPriceCents: intParam(q.maxPrice),
      onlyAvailable: q.disponivel === "1" || q.disponivel === "true",
      specKey: q.specKey,
      specValue: q.specValue,
      condicao,
    });

    reply.send({
      items: result.products,
      total: result.total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(result.total / limit)),
      facets: result.facets,
    });
  });

  // ---------------------------------------------------------------- Produto
  app.get("/api/store/products/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const found = await getProductBySlug(db, slug);
    if (!found) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Produto não encontrado" } });
      return;
    }

    // Relacionados/compatíveis completos (preço, foto, estoque) para vitrine.
    const relatedIds = found.related.map((r) => r.id);
    const compatibleIds = (found.compatibleIds ?? []) as string[];
    const [relatedFull, compatibleFull] = await Promise.all([
      relatedIds.length ? (await listProducts(db, { ids: relatedIds, page: 1, limit: relatedIds.length })).products : Promise.resolve([]),
      compatibleIds.length ? (await listProducts(db, { ids: compatibleIds, page: 1, limit: compatibleIds.length })).products : Promise.resolve([]),
    ]);
    const orderR = new Map(relatedIds.map((id, index) => [id, index]));
    relatedFull.sort((a, b) => (orderR.get(a.id) ?? 0) - (orderR.get(b.id) ?? 0));
    const orderC = new Map(compatibleIds.map((id, index) => [id, index]));
    compatibleFull.sort((a, b) => (orderC.get(a.id) ?? 0) - (orderC.get(b.id) ?? 0));

    reply.send({ ...found.product, related: relatedFull, compatible: compatibleFull });
  });

  // ---------------------------------------------------------------- Taxonomia
  app.get("/api/store/categories", async (_request, reply) => {
    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.active, true))
      .orderBy(asc(schema.categories.position), asc(schema.categories.name));

    const tree = rows
      .filter((c) => !c.parentId)
      .map((root) => ({
        ...root,
        children: rows
          .filter((c) => c.parentId === root.id)
          .map((child) => ({
            ...child,
            children: rows
              .filter((g) => g.parentId === child.id)
              .map((g) => ({
                id: g.id,
                name: g.name,
                slug: g.slug,
                ageRestricted: g.ageRestricted,
                parentId: g.parentId,
                active: g.active,
                position: g.position,
              })),
          })),
      }));

    reply.send(tree);
  });

  app.get("/api/store/brands", async (_request, reply) => {
    const rows = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.active, true))
      .orderBy(asc(schema.brands.position), asc(schema.brands.name));

    // Contagem em lote (evita N+1 por marca).
    const counts = rows.length
      ? await db
          .select({ brandId: schema.products.brandId, count: sql`count(*)::int` })
          .from(schema.products)
          .where(and(eq(schema.products.published, true), sql`${schema.products.brandId} is not null`))
          .groupBy(schema.products.brandId)
      : [];
    const countByBrand = new Map(counts.map((c) => [c.brandId, Number(c.count)]));

    const items = rows.map((brand) => ({
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      logoUrl: brand.logoUrl,
      description: brand.description,
      productCount: countByBrand.get(brand.id) ?? 0,
    }));
    reply.send(items);
  });

  // ---------------------------------------------------------------- Departamento
  //
  // O menu navega por departamento, categoria E subcategoria (o slug é
  // hierárquico). A rota resolve qualquer nível e devolve a subárvore
  // inteira — resolver só a raiz dava 404 em todo link de subcategoria.
  app.get("/api/store/departments/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const nodes = await loadTaxonomy(db);
    const node = findBySlug(nodes, slug);
    if (!node) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Departamento não encontrado" } });
      return;
    }

    const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
    const subtree = subtreeOf(nodes, node);
    const products = await listProducts(db, {
      category: node.slug,
      page: 1,
      limit: 12,
      sort: "featured_first",
    });

    const counts = await countProductsByCategory(db, subtree.map((n) => n.id));
    const children = childrenOf(nodes, node.id).map((child) => {
      const childSubtree = subtreeOf(nodes, child);
      const productCount = childSubtree.reduce(
        (sum, descendant) => sum + (counts.get(descendant.id) ?? 0),
        0,
      );
      return {
        id: child.id,
        name: child.name,
        slug: child.slug,
        imageUrl: child.imageUrl,
        ageRestricted: child.ageRestricted,
        productCount,
      };
    });

    reply.send({
      id: node.id,
      name: node.name,
      slug: node.slug,
      description: node.description,
      // Sem foto própria, a subcategoria herda a do departamento — página sem
      // imagem parece página quebrada.
      imageUrl: node.imageUrl ?? parent?.imageUrl ?? null,
      ageRestricted: node.ageRestricted,
      parent: parent
        ? { id: parent.id, name: parent.name, slug: parent.slug, imageUrl: parent.imageUrl }
        : null,
      children,
      products: products.products,
      total: products.total,
    });
  });

  // ---------------------------------------------------------------- Condições comerciais
  app.get("/api/store/settings", async (_request, reply) => {
    reply.send(await getCommercialSettings(db));
  });

  // ---------------------------------------------------------------- Dados da empresa (CNPJ do rodapé)
  app.get("/api/store/company", async (_request, reply) => {
    reply.send({ company: await getCompanyData(db) });
  });

  // ---------------------------------------------------------------- Rastreamento de pedido
  // Exige número do pedido + e-mail cadastrado: devolve só o que é do cliente.
  app.get("/api/store/orders/track", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const number = (q.number ?? "").trim().toUpperCase();
    const email = (q.email ?? "").trim().toLowerCase();
    if (!number || !email) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Informe o número do pedido e o e-mail" } });
      return;
    }

    const rows = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.number, number))
      .limit(1);
    const order = rows[0];
    if (!order) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Pedido não encontrado" } });
      return;
    }

    const customer = (
      await db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).limit(1)
    )[0];
    if (!customer || customer.email.toLowerCase() !== email) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Pedido não encontrado" } });
      return;
    }

    const items = await db
      .select({
        name: schema.orderItems.name,
        quantity: schema.orderItems.quantity,
        unitPriceCents: schema.orderItems.unitPriceCents,
        totalCents: schema.orderItems.totalCents,
      })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));

    const shipments = await db
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.orderId, order.id))
      .orderBy(asc(schema.shipments.createdAt));

    const events = shipments.length
      ? await db
          .select()
          .from(schema.shippingEvents)
          .where(eq(schema.shippingEvents.shipmentId, shipments[0]!.id))
          .orderBy(asc(schema.shippingEvents.createdAt))
      : [];

    const history = await db
      .select({
        toStatus: schema.orderStatusHistory.toStatus,
        reason: schema.orderStatusHistory.reason,
        createdAt: schema.orderStatusHistory.createdAt,
      })
      .from(schema.orderStatusHistory)
      .where(eq(schema.orderStatusHistory.orderId, order.id))
      .orderBy(asc(schema.orderStatusHistory.createdAt));

    reply.send({
      order: {
        number: order.number,
        status: order.status,
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        shippingCents: order.shippingCents,
        totalCents: order.totalCents,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
      items,
      shipment: shipments[0]
        ? {
            carrier: shipments[0].carrier,
            trackingCode: shipments[0].trackingCode,
            estimatedDays: shipments[0].estimatedDays,
            shippedAt: shipments[0].shippedAt,
            deliveredAt: shipments[0].deliveredAt,
          }
        : null,
      events,
      history,
    });
  });

  // ---------------------------------------------------------------- Chamado de atendimento
  app.post("/api/store/tickets", async (request, reply) => {
    const body = request.body as {
      name?: string;
      email?: string;
      subject?: string;
      message?: string;
    };
    const name = (body?.name ?? "").trim();
    const email = (body?.email ?? "").trim().toLowerCase();
    const subject = (body?.subject ?? "").trim();
    const message = (body?.message ?? "").trim();

    if (!name || !email || !subject || !message) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Preencha todos os campos" } });
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "E-mail inválido" } });
      return;
    }

    const [ticket] = await db
      .insert(schema.supportTickets)
      .values({ name: name.slice(0, 120), email: email.slice(0, 254), subject: subject.slice(0, 160), message })
      .returning();
    await db.insert(schema.notifications).values({
      kind: "support_ticket",
      title: "Chamado aberto: " + subject.slice(0, 120),
      body: "Novo chamado de " + name,
      severity: "info",
    });
    reply.status(201);
    reply.send({ ticket: ticket ? { id: ticket.id, status: ticket.status } : null });
  });

  // ---------------------------------------------------------------- Sugestões de busca
  app.get("/api/store/search/suggestions", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    reply.send(await searchSuggestions(db, q.q ?? ""));
  });

  // ---------------------------------------------------------------- Blog editorial
  // Leitura pública (loja) + gestão (painel) — mesma implementação, um registro.
  registerBlogRoutes(app, db);
}
