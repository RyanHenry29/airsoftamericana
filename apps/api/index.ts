// language: TS, file: apps/api/index.ts, target: Vercel Node Function (serverless)
// Entry point da API no Vercel usando handler HTTP nativo do Node.js.
// Importa fastify apenas para satisfazer o preset do projeto.
// Não instancia o fastify (incompatível com serverless da Vercel).
// Rotas delegam para a camada de serviços (Drizzle) — sem Fastify no runtime.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./src/config.js";
import { withSystemLock } from "./src/services/payments/system-locks.js";
import { getDb } from "./src/db/index.js";
import { schema } from "./src/db/index.js";
import { buildHome, getCommercialSettings, searchSuggestions } from "./src/services/homepage.js";
import { getCompanyData } from "./src/services/settings.js";
import { listProducts, getProductBySlug, type SortKey } from "./src/services/catalog.js";
import {
  childrenOf,
  countProductsByCategory,
  findBySlug,
  loadTaxonomy,
  subtreeOf,
} from "./src/services/taxonomy.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { signJwt, verifyJwt } from "./src/middleware/auth.js";
import { hashPassword, verifyPasswordDetailed } from "./src/lib/crypto.js";
import { cartItemSchema, checkoutSchema, loginSchema, registerSchema } from "@airsoft/shared";
import { validateCoupon } from "./src/services/coupons.js";
import { handleCheckout } from "./src/services/checkout.js";
import { getOrderDetailForCustomer } from "./src/services/orders.js";
import { routes as registerRoutes } from "./src/routes/index.js";
import { registerMfaRoutes } from "./src/routes/mfa.js";
import { registerWebhookRoutes } from "./src/routes/webhooks.js";

const SORTS: SortKey[] = [
  "featured_first",
  "news",
  "price_asc",
  "price_desc",
  "name_asc",
  "bestsellers",
];

const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string | string[]> = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-credentials": "true",
    ...securityHeaders,
    ...extraHeaders,
  } as any);
  res.end(JSON.stringify(body));
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function isDelegatedPath(path: string, method: string): boolean {
  return (
    path.startsWith("/api/admin") ||
    path === "/api/auth/admin-login" ||
    path === "/api/auth/admin-logout" ||
    path.startsWith("/api/auth/invite") ||
    path.startsWith("/api/webhooks") ||
    // Blog: leitura pública e gestão do painel vivem nas rotas Fastify —
    // uma implementação só, delegada como os demais caminhos administrativos.
    path.startsWith("/api/store/blog") ||
    // Perfil e endereços do cliente: implementação única nas rotas Fastify
    // (PUT /api/auth/me; GET/POST/PUT/DELETE abaixo). O GET /api/auth/me
    // continua no handler crudo — é chamado em toda página e não precisa
    // do peso do Fastify.
    path.startsWith("/api/customer/addresses") ||
    (method === "PUT" && path === "/api/auth/me") ||
    // Esqueci a senha: rate-limit e serviço de e-mail vivem no Fastify.
    (method === "POST" && (path === "/api/auth/forgot-password" || path === "/api/auth/reset-password"))
  );
}

let fastifyAppPromise: Promise<ReturnType<typeof Fastify>> | null = null;

async function getFastifyApp() {
  if (!fastifyAppPromise) {
    fastifyAppPromise = (async () => {
      const app = Fastify({ logger: false, trustProxy: true });
      await app.register(cookie);
      await app.register(cors, { origin: true, credentials: true });
      const db = await getDb();
      (app as any).db = db;
      
      // Security headers for Fastify (local dev)
      app.addHook("onSend", async (_req, reply) => {
        reply.header("X-Frame-Options", "DENY");
        reply.header("X-Content-Type-Options", "nosniff");
        reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
        reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
        reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      });
      
      await registerRoutes(app, config as any, db);
      try { registerMfaRoutes(app, db); } catch {}
      try { await registerWebhookRoutes(app, db); } catch {}

      // Recuperação no boot (AUD-15/ponto 1 e 8 da revisão): eventos
      // persistidos mas não aplicados (crash, corrida checkout×webhook) e
      // estados parciais legados (pagamento atualizado, pedido não). Não
      // fatal — falha de recuperação não impede a API de subir.
      try {
        const { recoverPendingEvents, repairPartialApplications, LeaseLostError } = await import("./src/services/payments/webhook-events.js");
        const { expireStaleReservations, startPaymentMaintenance } = await import("./src/services/payments/expiry.js");
        const runMaintenance = async (lockCtx?: { lost: () => boolean; lockName?: string; leaseToken?: string }) => {
          // Revisão v5 (item 5): perda do lock confirmada pelo heartbeat ⇒
          // aborta entre fases — não executa manutenção sem ser o dono.
          if (lockCtx?.lost()) return { aborted: true };
          try {
            const recovery = await recoverPendingEvents(db);
            if (lockCtx?.lost()) return { aborted: true, recovery };
            const repair = await repairPartialApplications(db, {
              lockName: lockCtx?.lockName ?? "payment_maintenance",
              leaseToken: lockCtx?.leaseToken,
              lost: lockCtx?.lost,
            });
            if (lockCtx?.lost()) return { aborted: true, recovery, repair };
            // Expiração SEGURA de reservas: só libera estoque após confirmar o
            // estado da cobrança no provedor (com tolerância e dupla
            // confirmação) — cobrança viva nunca é cancelada.
            const expiry = await expireStaleReservations(db, { olderThanMinutes: 60, notFoundGraceMinutes: 24 * 60 });
            app.log.info({ recovery, repair, expiry }, "payment event recovery at boot");
            return { recovery, repair, expiry };
          } catch (err) {
            if (err instanceof LeaseLostError) {
              app.log.warn({ err: err.message, phase: "payment_maintenance" }, "manutenção abortada: lease perdido");
              return { aborted: true };
            }
            throw err;
          }
        };
        await withSystemLock(db, "payment_maintenance", 5 * 60 * 1000, runMaintenance).then((r) => {
          // r.ok=false = outra instância detém o lease e conduz a passada.
          if (!r.ok) app.log.info("payment maintenance at boot skipped: lease held by another instance");
        });
        // Varrimento periódico (revisão v4): boot sozinho não cobre processos
        // longevos — reservas abandonadas com a aplicação ligada precisam do
        // intervalo. 15 min, não-reentrante, unref.
        startPaymentMaintenance(db, runMaintenance, { intervalMs: 15 * 60 * 1000 });
      } catch (err) {
        app.log.warn({ err }, "payment event recovery skipped");
      }

      await app.ready();
      return app;
    })().catch((e) => {
      fastifyAppPromise = null;
      throw e;
    });
  }
  return fastifyAppPromise;
}

async function delegateToFastify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getFastifyApp();
  await app.ready();
  return new Promise<void>((resolve, reject) => {
    const done = () => resolve();
    res.on("finish", done);
    res.on("close", done);
    try {
      if (typeof (app as any).routing === "function") {
        (app as any).routing(req, res);
      } else {
        (app.server as any).emit("request", req, res);
      }
    } catch (e) {
      reject(e);
    }
  });
}

function cookieString(name: string, value: string, opts: { maxAge?: number; path?: string; httpOnly?: boolean; sameSite?: string; secure?: boolean } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  if (opts.secure) parts.push("Secure");
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

function clearCookieString(name: string): string {
  return cookieString(name, "", { maxAge: 0, path: "/" });
}

function publicCustomer(row: { id: string; name: string; email: string; cpf: string | null; phone: string | null; createdAt: Date | string }) {
  return { id: row.id, name: row.name, email: row.email, cpf: row.cpf, phone: row.phone, createdAt: row.createdAt };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "cliente";
  return `${user.slice(0, 1)}${"*".repeat(Math.max(3, user.length - 1))}@${domain}`;
}

function parseUrl(raw: string): { path: string; query: Record<string, string> } {
  try {
    const u = new URL(raw, "http://localhost");
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => { query[k] = v; });
    return { path: u.pathname, query };
  } catch {
    return { path: raw.split("?")[0] ?? "/", query: {} };
  }
}

function intParam(value: string | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const { path, query } = parseUrl(req.url ?? "/");

  if (path === "/healthz") return json(res, 200, { status: "ok", timestamp: new Date().toISOString() });
  if (path === "/") return json(res, 200, { name: "Airsoft Americana API", version: "0.1.0" });

  const origin = (req.headers.origin as string) || "";
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": origin || "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, cookie, x-csrf-token",
    });
    res.end();
    return;
  }

  if (isDelegatedPath(path, method)) {
    try {
      await delegateToFastify(req, res);
    } catch (e) {
      const err = e as Error;
      console.error(`[api:admin] ${method} ${path}:`, err?.message, err?.stack?.split("\n")[1]);
      json(res, 500, { error: { code: "internal_error", message: "Erro interno do servidor" } });
    }
    return;
  }

  try {
    await route(method, path, query, req, res);
  } catch (e) {
    const err = e as Error;
    console.error(`[api] ${method} ${path}:`, err?.message, err?.stack?.split("\n")[1]);
    json(res, 500, { error: { code: "internal_error", message: "Erro interno do servidor" } });
  }
}

async function route(
  method: string,
  path: string,
  query: Record<string, string>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const db = await getDb();

  // ── Storefront: home ──────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/store/home") {
    return json(res, 200, await buildHome(db));
  }

  // ── Storefront: settings ──────────────────────────────────────────────────
  if (method === "GET" && path === "/api/store/settings") {
    return json(res, 200, await getCommercialSettings(db));
  }

  // ── Storefront: dados da empresa (CNPJ do rodapé) ─────────────────────────
  if (method === "GET" && path === "/api/store/company") {
    return json(res, 200, { company: await getCompanyData(db) });
  }

  // ── Storefront: products list ─────────────────────────────────────────────
  if (method === "GET" && path === "/api/store/products") {
    const page = Math.max(1, intParam(query.page) ?? 1);
    const limit = Math.min(60, Math.max(1, intParam(query.limit) ?? 24));
    const sort = (SORTS.includes(query.sort as SortKey) ? query.sort : "featured_first") as SortKey;
    const condRaw = (query.condicao ?? query.condition ?? "").trim();
    const condicao = condRaw === "novo" || condRaw === "usado" || condRaw === "seminovo" ? condRaw : undefined;
    const result = await listProducts(db, {
      category: query.categoria ?? query.category,
      brand: query.brand,
      q: query.q,
      sort,
      page,
      limit,
      minPriceCents: intParam(query.minPrice),
      maxPriceCents: intParam(query.maxPrice),
      onlyAvailable: query.disponivel === "1" || query.disponivel === "true",
      specKey: query.specKey,
      specValue: query.specValue,
      condicao,
    });
    return json(res, 200, {
      items: result.products,
      total: result.total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(result.total / limit)),
      facets: result.facets,
    });
  }

  // ── Storefront: product by slug ───────────────────────────────────────────
  const productMatch = path.match(/^\/api\/store\/products\/([^/]+)$/);
  if (method === "GET" && productMatch) {
    const slug = decodeURIComponent(productMatch[1]!);
    const found = await getProductBySlug(db, slug);
    if (!found) return json(res, 404, { error: { code: "not_found", message: "Produto não encontrado" } });
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
    return json(res, 200, { ...found.product, related: relatedFull, compatible: compatibleFull });
  }

  // ── Storefront: categories tree ───────────────────────────────────────────
  if (method === "GET" && path === "/api/store/categories") {
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
                id: g.id, name: g.name, slug: g.slug, ageRestricted: g.ageRestricted,
                parentId: g.parentId, active: g.active, position: g.position,
              })),
          })),
      }));
    return json(res, 200, tree);
  }

  // ── Storefront: brands ────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/store/brands") {
    const rows = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.active, true))
      .orderBy(asc(schema.brands.position), asc(schema.brands.name));
    const counts = rows.length
      ? await db
          .select({ brandId: schema.products.brandId, count: sql`count(*)::int` })
          .from(schema.products)
          .where(and(eq(schema.products.published, true), sql`${schema.products.brandId} is not null`))
          .groupBy(schema.products.brandId)
      : [];
    const countByBrand = new Map(counts.map((c) => [c.brandId, Number(c.count)]));
    return json(res, 200, rows.map((brand) => ({
      id: brand.id, name: brand.name, slug: brand.slug,
      logoUrl: brand.logoUrl, description: brand.description,
      productCount: countByBrand.get(brand.id) ?? 0,
    })));
  }

  // ── Storefront: department by slug ────────────────────────────────────────
  const deptMatch = path.match(/^\/api\/store\/departments\/([^/]+)$/);
  if (method === "GET" && deptMatch) {
    const slug = decodeURIComponent(deptMatch[1]!);
    const nodes = await loadTaxonomy(db);
    const node = findBySlug(nodes, slug);
    if (!node) return json(res, 404, { error: { code: "not_found", message: "Departamento não encontrado" } });
    const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
    const subtree = subtreeOf(nodes, node);
    const products = await listProducts(db, { category: node.slug, page: 1, limit: 12, sort: "featured_first" });
    const counts = await countProductsByCategory(db, subtree.map((n) => n.id));
    const children = childrenOf(nodes, node.id).map((child) => {
      const childSubtree = subtreeOf(nodes, child);
      const productCount = childSubtree.reduce((sum, d) => sum + (counts.get(d.id) ?? 0), 0);
      return { id: child.id, name: child.name, slug: child.slug, imageUrl: child.imageUrl, ageRestricted: child.ageRestricted, productCount };
    });
    return json(res, 200, {
      id: node.id, name: node.name, slug: node.slug, description: node.description,
      imageUrl: node.imageUrl ?? parent?.imageUrl ?? null,
      ageRestricted: node.ageRestricted,
      parent: parent ? { id: parent.id, name: parent.name, slug: parent.slug, imageUrl: parent.imageUrl } : null,
      children,
      products: products.products,
      total: products.total,
    });
  }

  // ── Storefront: search suggestions ────────────────────────────────────────
  if (method === "GET" && path === "/api/store/search/suggestions") {
    return json(res, 200, await searchSuggestions(db, query.q ?? ""));
  }

  // ── Storefront: order tracking ────────────────────────────────────────────
  if (method === "GET" && path === "/api/store/orders/track") {
    const number = (query.number ?? "").trim().toUpperCase();
    const email = (query.email ?? "").trim().toLowerCase();
    if (!number || !email) return json(res, 400, { error: { code: "invalid_input", message: "Informe o número do pedido e o e-mail" } });
    const rows = await db.select().from(schema.orders).where(eq(schema.orders.number, number)).limit(1);
    const order = rows[0];
    if (!order) return json(res, 404, { error: { code: "not_found", message: "Pedido não encontrado" } });
    const customer = (await db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).limit(1))[0];
    if (!customer || customer.email.toLowerCase() !== email) return json(res, 404, { error: { code: "not_found", message: "Pedido não encontrado" } });
    const items = await db.select({ name: schema.orderItems.name, quantity: schema.orderItems.quantity, unitPriceCents: schema.orderItems.unitPriceCents, totalCents: schema.orderItems.totalCents }).from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    const shipments = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, order.id)).orderBy(asc(schema.shipments.createdAt));
    const events = shipments.length ? await db.select().from(schema.shippingEvents).where(eq(schema.shippingEvents.shipmentId, shipments[0]!.id)).orderBy(asc(schema.shippingEvents.createdAt)) : [];
    const history = await db.select({ toStatus: schema.orderStatusHistory.toStatus, reason: schema.orderStatusHistory.reason, createdAt: schema.orderStatusHistory.createdAt }).from(schema.orderStatusHistory).where(eq(schema.orderStatusHistory.orderId, order.id)).orderBy(asc(schema.orderStatusHistory.createdAt));
    return json(res, 200, {
      order: { number: order.number, status: order.status, subtotalCents: order.subtotalCents, discountCents: order.discountCents, shippingCents: order.shippingCents, totalCents: order.totalCents, paymentMethod: order.paymentMethod, createdAt: order.createdAt, updatedAt: order.updatedAt },
      items,
      shipment: shipments[0] ? { carrier: shipments[0].carrier, trackingCode: shipments[0].trackingCode, estimatedDays: shipments[0].estimatedDays, shippedAt: shipments[0].shippedAt, deliveredAt: shipments[0].deliveredAt } : null,
      events, history,
    });
  }

  // ── Storefront: support ticket (POST) ─────────────────────────────────────
  if (method === "POST" && path === "/api/store/tickets") {
    const body = (await readBody(req)) as { name?: string; email?: string; subject?: string; message?: string };
    const name = (body?.name ?? "").trim();
    const email = (body?.email ?? "").trim().toLowerCase();
    const subject = (body?.subject ?? "").trim();
    const message = (body?.message ?? "").trim();
    if (!name || !email || !subject || !message) return json(res, 400, { error: { code: "invalid_input", message: "Preencha todos os campos" } });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return json(res, 400, { error: { code: "invalid_input", message: "E-mail inválido" } });
    const [ticket] = await db.insert(schema.supportTickets).values({ name: name.slice(0, 120), email: email.slice(0, 254), subject: subject.slice(0, 160), message }).returning();
    await db.insert(schema.notifications).values({ kind: "support_ticket", title: "Chamado aberto: " + subject.slice(0, 120), body: "Novo chamado de " + name, severity: "info" });
    return json(res, 201, { ticket: ticket ? { id: ticket.id, status: ticket.status } : null });
  }

  // ── Newsletter (POST) ─────────────────────────────────────────────────────
  if (method === "POST" && path === "/api/newsletter") {
    const body = (await readBody(req)) as { email?: string; source?: string };
    const email = (body?.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 254) return json(res, 400, { error: { code: "invalid_input", message: "E-mail inválido" } });
    const source = (body?.source ?? "homepage").slice(0, 40);
    await db.insert(schema.newsletterSubscribers).values({ email, source, consent: true }).onConflictDoNothing({ target: schema.newsletterSubscribers.email });
    return json(res, 201, { success: true });
  }

  // ── Shipping quote (POST) ─────────────────────────────────────────────────
  if (method === "POST" && path === "/api/shipping/quote") {
    const body = (await readBody(req)) as { zip?: string; items?: { variantId: string; quantity: number }[]; subtotalCents?: number };
    const zip = (body.zip ?? "").replace(/\D/g, "");
    if (zip.length !== 8) return json(res, 400, { error: { code: "invalid_input", message: "CEP inválido" } });
    let subtotalCents = body.subtotalCents ?? 0;
    let weight = 0;
    if (body.items?.length) {
      for (const item of body.items) {
        const vRows = await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, item.variantId)).limit(1);
        const v = vRows[0];
        if (v) { subtotalCents += (v.promoPriceCents ?? v.priceCents) * item.quantity; weight += v.weightGrams * item.quantity; }
      }
    }
    // Frete simplificado para serverless (Correios PAC/SEDEX estimado)
    const freeFrom = (await getCommercialSettings(db)).free_shipping_from_cents;
    const free = freeFrom > 0 && subtotalCents >= freeFrom;
    const base = Math.max(1990, Math.ceil(weight / 100) * 350);
    return json(res, 200, {
      options: [
        { carrier: "Correios", service: "PAC", priceCents: free ? 0 : base, estimatedDays: 8, free },
        { carrier: "Correios", service: "SEDEX", priceCents: free ? 0 : Math.ceil(base * 1.8), estimatedDays: 4, free },
      ],
      freeShippingFromCents: freeFrom,
    });
  }

  // ── Auth: Google (Supabase token → aa_customer session) ───────────────────
  if (method === "POST" && path === "/api/auth/google") {
    const body = (await readBody(req)) as { accessToken?: unknown };
    const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    if (!accessToken) return json(res, 400, { error: { code: "invalid_input", message: "Token de acesso ausente" } });

    let sbUser: { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null; user_metadata?: Record<string, unknown> };
    try {
      const sRes = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${accessToken}`, apikey: config.SUPABASE_PUBLISHABLE_KEY },
      });
      if (!sRes.ok) return json(res, 401, { error: { code: "unauthorized", message: "Sessão do Google inválida ou expirada. Tente entrar de novo." } });
      sbUser = (await sRes.json()) as typeof sbUser;
    } catch {
      return json(res, 502, { error: { code: "upstream_error", message: "Não foi possível validar o acesso agora. Tente de novo." } });
    }

    const rawEmail = typeof sbUser.email === "string" ? sbUser.email.trim().toLowerCase() : "";
    const confirmed = sbUser.email_confirmed_at || sbUser.confirmed_at;
    if (!rawEmail || !confirmed) return json(res, 401, { error: { code: "unauthorized", message: "Conta Google sem e-mail verificado." } });

    const meta = sbUser.user_metadata ?? {};
    const name = (typeof meta.full_name === "string" && meta.full_name.trim()) || (typeof meta.name === "string" && meta.name.trim()) || rawEmail.split("@")[0] || "Cliente";

    let found = await db.select().from(schema.customers).where(eq(schema.customers.email, rawEmail)).limit(1);
    let customer = found[0];
    let created = false;
    if (!customer) {
      let inserted: typeof found = [];
      try {
        inserted = await db.insert(schema.customers).values({ name, email: rawEmail, passwordHash: null }).onConflictDoNothing({ target: schema.customers.email }).returning() as typeof found;
      } catch (err) {
        if (!(err instanceof Error && err.message.includes("duplicate key"))) throw err;
      }
      customer = inserted[0];
      if (!customer) { found = await db.select().from(schema.customers).where(eq(schema.customers.email, rawEmail)).limit(1); customer = found[0]; }
      else created = true;
    }
    if (!customer) return json(res, 500, { error: { code: "internal", message: "Não foi possível concluir o acesso." } });

    const token = await signJwt({ sub: customer.id, role: "customer", type: "customer" });
    const secure = config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none";
    return json(res, 200, { customer: publicCustomer(customer), created }, {
      "Set-Cookie": cookieString("aa_customer", token, { maxAge: 60 * 60 * 24 * 7, sameSite: config.COOKIE_SAMESITE ?? "Lax", secure }),
    });
  }

  // ── Auth: me ──────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/auth/me") {
    const cookies = parseCookies(req);
    const token = cookies["aa_customer"] || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "");
    if (!token) return json(res, 401, { error: { code: "unauthorized", message: "Não autenticado" } });
    try {
      const payload = await verifyJwt(token);
      if (payload.type !== "customer") throw new Error("wrong type");
      const found = await db.select().from(schema.customers).where(eq(schema.customers.id, payload.sub)).limit(1);
      const customer = found[0];
      if (!customer) return json(res, 401, { error: { code: "unauthorized", message: "Não autenticado" } });
      return json(res, 200, { customer: publicCustomer(customer) });
    } catch {
      return json(res, 401, { error: { code: "unauthorized", message: "Token inválido ou expirado" } });
    }
  }

  // ── Auth: login ───────────────────────────────────────────────────────────
  if (method === "POST" && path === "/api/auth/login") {
    const parsed = loginSchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
    const { email, password } = parsed.data;
    const found = await db.select().from(schema.customers).where(eq(schema.customers.email, email)).limit(1);
    const customer = found[0];
    const { ok } = customer?.passwordHash ? await verifyPasswordDetailed(password, customer.passwordHash) : { ok: false as const };
    if (!ok || !customer) return json(res, 401, { error: { code: "unauthorized", message: "E-mail ou senha incorretos" } });
    const token = await signJwt({ sub: customer.id, role: "customer", type: "customer" });
    const secure = config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none";
    return json(res, 200, { customer: publicCustomer(customer) }, {
      "Set-Cookie": cookieString("aa_customer", token, { maxAge: 60 * 60 * 24 * 7, sameSite: config.COOKIE_SAMESITE ?? "Lax", secure }),
    });
  }

  // ── Auth: register ────────────────────────────────────────────────────────
  if (method === "POST" && path === "/api/auth/register") {
    const parsed = registerSchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
    const { name, email, password, cpf, phone } = parsed.data;
    const cleanCpf = cpf ? String(cpf).replace(/\D/g, "") : null;
    if (cleanCpf && cleanCpf.length !== 11) return json(res, 400, { error: { code: "invalid_input", message: "CPF deve conter 11 dígitos" } });
    const existing = await db.select().from(schema.customers).where(eq(schema.customers.email, email)).limit(1);
    if (existing.length > 0) return json(res, 409, { error: { code: "email_taken", message: "E-mail já cadastrado. Faça login." } });
    const passwordHash = await hashPassword(password);
    let inserted: any[] = [];
    try {
      inserted = await db.insert(schema.customers).values({ name, email, passwordHash, cpf: cleanCpf, phone: phone || null }).onConflictDoNothing({ target: schema.customers.email }).returning();
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("duplicate key"))) throw err;
    }
    const customer = inserted[0];
    if (!customer) return json(res, 409, { error: { code: "email_taken", message: "E-mail já cadastrado. Faça login." } });
    const token = await signJwt({ sub: customer.id, role: "customer", type: "customer" });
    const secure = config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none";
    return json(res, 201, { customer: publicCustomer(customer) }, {
      "Set-Cookie": cookieString("aa_customer", token, { maxAge: 60 * 60 * 24 * 7, sameSite: config.COOKIE_SAMESITE ?? "Lax", secure }),
    });
  }

  // ── Auth: logout ──────────────────────────────────────────────────────────
  if (method === "POST" && path === "/api/auth/logout") {
    return json(res, 200, { success: true }, { "Set-Cookie": clearCookieString("aa_customer") });
  }

  // ── Cart helpers ──────────────────────────────────────────────────────────
  async function resolveCustomer() {
    const cookies = parseCookies(req);
    const token = cookies["aa_customer"] || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "");
    if (!token) return null;
    try {
      const payload = await verifyJwt(token);
      if (payload.type !== "customer") return null;
      return { id: payload.sub };
    } catch { return null; }
  }

  async function getOrCreateCart(): Promise<{ cart: any; sessionKey?: string }> {
    const customer = await resolveCustomer();
    const cookies = parseCookies(req);
    let sessionKey = cookies["aa_cart"];
    if (customer) {
      const found = await db.select().from(schema.carts).where(eq(schema.carts.customerId, customer.id)).limit(1);
      if (found[0]) return { cart: found[0] };
    }
    if (sessionKey) {
      const found = await db.select().from(schema.carts).where(eq(schema.carts.sessionKey, sessionKey)).limit(1);
      if (found[0]) return { cart: found[0] };
    }
    sessionKey = randomUUID().replace(/-/g, "").slice(0, 32);
    const inserted = await db.insert(schema.carts).values({ sessionKey, customerId: customer?.id ?? null }).returning();
    return { cart: inserted[0]!, sessionKey };
  }

  async function cartView(cartId: string) {
    const items = await db.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cartId));
    const view: any[] = [];
    let subtotalCents = 0;
    let ageRestricted = false;
    for (const item of items) {
      const variants = await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, item.variantId)).limit(1);
      const variant = variants[0];
      if (!variant) continue;
      const invRows = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, variant.id)).limit(1);
      const inv = invRows[0];
      const available = inv ? inv.physical - inv.reserved : 0;
      const unitPriceCents = variant.promoPriceCents ?? variant.priceCents;
      const productRow = await db.select().from(schema.products).where(eq(schema.products.id, variant.productId)).limit(1);
      const product = productRow[0];
      let itemAgeRestricted = !!product?.ageRestricted;
      if (product?.categoryId) {
        const catRows = await db.select().from(schema.categories).where(eq(schema.categories.id, product.categoryId)).limit(1);
        if (catRows[0]?.ageRestricted) itemAgeRestricted = true;
      }
      if (itemAgeRestricted) ageRestricted = true;
      subtotalCents += unitPriceCents * item.quantity;
      view.push({ variantId: variant.id, sku: variant.sku, slug: product?.slug ?? variant.sku, name: variant.name, quantity: item.quantity, unitPriceCents, totalCents: unitPriceCents * item.quantity, available, ageRestricted: itemAgeRestricted });
    }
    return { items: view, subtotalCents, ageRestricted };
  }

  function cartCookieHeader(sessionKey?: string): Record<string, string> | undefined {
    if (!sessionKey) return undefined;
    const secure = config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none";
    return { "Set-Cookie": cookieString("aa_cart", sessionKey, { maxAge: 60 * 60 * 24 * 7, sameSite: config.COOKIE_SAMESITE ?? "Lax", secure }) };
  }

  // ── Cart routes ───────────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/cart") {
    const { cart, sessionKey } = await getOrCreateCart();
    const view = await cartView(cart.id);
    const cartRow = await db.select().from(schema.carts).where(eq(schema.carts.id, cart.id)).limit(1);
    return json(res, 200, { ...view, coupon: cartRow[0]?.couponCode ?? null }, cartCookieHeader(sessionKey));
  }

  if (method === "POST" && path === "/api/cart/items") {
    const parsed = cartItemSchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
    const { cart, sessionKey } = await getOrCreateCart();
    const variants = await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, parsed.data.variantId)).limit(1);
    if (!variants[0]) return json(res, 404, { error: { code: "not_found", message: "Variante não encontrada" } });
    const invRows = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, parsed.data.variantId)).limit(1);
    const inv = invRows[0];
    if (inv && inv.physical - inv.reserved < parsed.data.quantity) return json(res, 409, { error: { code: "insufficient_stock", message: "Estoque insuficiente", available: inv.physical - inv.reserved } });
    const existing = await db.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cart.id));
    const line = existing.find((i) => i.variantId === parsed.data.variantId);
    if (line) await db.update(schema.cartItems).set({ quantity: parsed.data.quantity }).where(eq(schema.cartItems.id, line.id));
    else await db.insert(schema.cartItems).values({ id: randomUUID(), cartId: cart.id, variantId: parsed.data.variantId, quantity: parsed.data.quantity });
    const view = await cartView(cart.id);
    const cartRow = await db.select().from(schema.carts).where(eq(schema.carts.id, cart.id)).limit(1);
    return json(res, 200, { ...view, coupon: cartRow[0]?.couponCode ?? null }, cartCookieHeader(sessionKey));
  }

  const cartItemMatch = path.match(/^\/api\/cart\/items\/([^/]+)$/);
  if (cartItemMatch && (method === "PATCH" || method === "DELETE")) {
    const variantId = decodeURIComponent(cartItemMatch[1]!);
    const { cart, sessionKey } = await getOrCreateCart();
    const existing = await db.select().from(schema.cartItems).where(eq(schema.cartItems.cartId, cart.id));
    const line = existing.find((i) => i.variantId === variantId);
    if (!line) return json(res, 404, { error: { code: "not_found", message: "Item não está no carrinho" } });
    if (method === "DELETE") {
      await db.delete(schema.cartItems).where(eq(schema.cartItems.id, line.id));
    } else {
      const body = (await readBody(req)) as { quantity?: number };
      const quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) return json(res, 400, { error: { code: "invalid_input", message: "Quantidade inválida" } });
      if (quantity === 0) await db.delete(schema.cartItems).where(eq(schema.cartItems.id, line.id));
      else await db.update(schema.cartItems).set({ quantity }).where(eq(schema.cartItems.id, line.id));
    }
    const view = await cartView(cart.id);
    const cartRow = await db.select().from(schema.carts).where(eq(schema.carts.id, cart.id)).limit(1);
    return json(res, 200, { ...view, coupon: cartRow[0]?.couponCode ?? null }, cartCookieHeader(sessionKey));
  }

  if (path === "/api/cart/coupon") {
    const { cart } = await getOrCreateCart();
    if (method === "DELETE") {
      await db.update(schema.carts).set({ couponCode: null }).where(eq(schema.carts.id, cart.id));
      const view = await cartView(cart.id);
      return json(res, 200, { ...view, coupon: null });
    }
    if (method === "POST") {
      const body = (await readBody(req)) as { code?: string };
      const view = await cartView(cart.id);
      const validation = await validateCoupon(db, { code: body.code ?? "", subtotalCents: view.subtotalCents });
      if (!validation.valid) return json(res, 400, { error: { code: "invalid_coupon", message: validation.message ?? "Cupom inválido" } });
      await db.update(schema.carts).set({ couponCode: (body.code ?? "").trim().toUpperCase() }).where(eq(schema.carts.id, cart.id));
      return json(res, 200, { ...view, coupon: (body.code ?? "").trim().toUpperCase(), discountCents: validation.discountCents });
    }
  }

  // -- Coupons validate (storefront) -----------------------------------------
  if (method === "GET" && path === "/api/coupons/validate") {
    const code = String(query["code"] ?? "");
    const subtotalCents = Number(query["subtotalCents"] ?? 0) || 0;
    const result = await validateCoupon(db, { code, subtotalCents });
    return json(res, 200, result);
  }

  // -- Checkout --------------------------------------------------------------
  if (method === "POST" && path === "/api/checkout") {
    const customer = await resolveCustomer();
    if (!customer) return json(res, 401, { error: { code: "unauthorized", message: "Faça login para finalizar a compra" } });
    const parsed = checkoutSchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
    try {
      const forwarded = req.headers["x-forwarded-for"];
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || req.socket?.remoteAddress;
      const correlationId = (req.headers["x-vercel-id"] as string) || (req.headers["x-request-id"] as string) || randomUUID();
      const result = await handleCheckout(db, parsed.data as any, { customerId: customer.id, ip, correlationId });
      return json(res, 201, result);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return json(res, status, { error: { code: (err as { code?: string }).code ?? "internal_error", message: err instanceof Error ? err.message : "Erro interno", details: (err as { details?: unknown }).details } });
    }
  }

  // -- Orders (customer) -----------------------------------------------------
  if (method === "GET" && path === "/api/orders") {
    const customer = await resolveCustomer();
    if (!customer) return json(res, 401, { error: { code: "unauthorized", message: "Não autenticado" } });
    const rows = await db.select().from(schema.orders).where(eq(schema.orders.customerId, customer.id)).orderBy(desc(schema.orders.createdAt));
    return json(res, 200, { items: rows });
  }

  const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (method === "GET" && orderMatch) {
    const customer = await resolveCustomer();
    if (!customer) return json(res, 401, { error: { code: "unauthorized", message: "Não autenticado" } });
    const number = decodeURIComponent(orderMatch[1]!);
    const found = await db.select().from(schema.orders).where(eq(schema.orders.number, number)).limit(1);
    const order = found[0];
    if (!order || order.customerId !== customer.id) return json(res, 404, { error: { code: "not_found", message: "Pedido não encontrado" } });
    // ESPIAR/COMPRAR: mesmo contrato da Fastify — { order, items } com slug e
    // variantes ativas. Sem isto o modal da conta quebra em produção.
    try {
      const detail = await getOrderDetailForCustomer(db, { orderId: order.id, customerId: customer.id });
      return json(res, 200, { order: detail.order, items: detail.items });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      return json(res, status, { error: { code: (err as { code?: string }).code ?? "internal_error", message: err instanceof Error ? err.message : "Erro interno" } });
    }
  }

  // -- Banner image serve (public) -------------------------------------------
  const bannerImgMatch = path.match(/^\/api\/banners\/image\/([^/]+)$/);
  if (method === "GET" && bannerImgMatch) {
    const id = decodeURIComponent(bannerImgMatch[1]!);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json(res, 404, { error: { code: "not_found", message: "Imagem não encontrada" } });
    }
    const [row] = await db
      .select({ mime: schema.bannerImages.mime, bytes: schema.bannerImages.bytes })
      .from(schema.bannerImages)
      .where(eq(schema.bannerImages.id, id))
      .limit(1);
    if (!row) return json(res, 404, { error: { code: "not_found", message: "Imagem não encontrada" } });
    res.writeHead(200, {
      "content-type": row.mime,
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
    });
    res.end(Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes as unknown as Uint8Array));
    return;
  }

  // -- Fallback --------------------------------------------------------------
  return json(res, 404, { error: { code: "not_found", message: "Rota não encontrada", path } });
}

export async function createServer() {
  return getFastifyApp();
}
