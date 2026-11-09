import type { FastifyInstance, FastifyRequest } from "fastify";
import { asc, and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { hashPassword, verifyPasswordDetailed } from "../lib/crypto.js";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import { auditLogs, brands, cartItems, carts, categories, chargebacks, coupons, customers, inventory, inventoryMovements, newsletterSubscribers, orderItems, orders, paymentEvents, payments, productImages, products, productVariants, users } from "../db/schema.js";
import { authMiddleware, signJwt, verifyJwt } from "../middleware/auth.js";
import { adminGuard, normalizeRole } from "../lib/rbac.js";
import { createSession, adminSessionCookieOptions, ADMIN_SESSION_COOKIE, hashToken } from "../services/sessions.js";
import { acceptInvite } from "../services/invites.js";
import { isLocked, registerFailure, registerSuccess, lockoutKeys } from "../services/lockout.js";
import { outboxNotify, loginNewDeviceBody } from "../services/outbox.js";
import { schema } from "../db/index.js";
import { appendProductHistory, canSeeCost } from "../services/product-history.js";
import { authRateLimit, adminLoginRateLimitRule, loginRateLimitRule, registerRateLimitRule } from "../middleware/authRateLimit.js";
import type { Config } from "../config.js";
import { registerSchema, loginSchema, adminCustomerSchema, checkoutSchema, cartItemSchema, orderStatusSchema, stockMovementSchema, productSchema, orderVolumeLimitsSchema, gatewayConfigSchema, chargebackStatusSchema } from "@airsoft/shared";
import { handleCheckout } from "../services/checkout.js";
import { transitionOrder } from "../services/orders.js";
import { validateCoupon } from "../services/coupons.js";
import { calculateShipping } from "../services/shipping.js";
import { getFreeShippingFromCents } from "../services/settings.js";
import { canTransition, type OrderStatus } from "@airsoft/shared";
import { registerAdapter, type NormalizedWebhookEvent } from "../services/payments/types.js";
import { getAdapter } from "../services/payments/types.js";
import { adjustStock, adjustStockInTx } from "../services/inventory.js";
import { registerStorefrontRoutes } from "./storefront.js";
import { registerAdminRoutes } from "./admin.js";

export interface ApiRoutesOptions {
  config: Config;
}

function publicCustomer(row: typeof customers.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    cpf: row.cpf,
    phone: row.phone,
    createdAt: row.createdAt,
  };
}

function customerToken(req: {
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string>;
}): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookies = (req as { cookies?: Record<string, string> }).cookies;
  if (cookies?.["aa_customer"]) return String(cookies["aa_customer"]);
  return undefined;
}

async function requireCustomer(req: {
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string>;
}): Promise<{ id: string } | null> {
  const token = customerToken(req);
  if (!token) return null;
  try {
    const payload = await verifyJwt(token);
    if (payload.type !== "customer") return null;
    return { id: payload.sub };
  } catch {
    return null;
  }
}

async function getCart(db: Db, req: {
  cookies?: Record<string, string>;
  headers: Record<string, string | undefined>;
}) {
  const customer = await requireCustomer(req as never);
  let sessionKey = (req as { cookies?: Record<string, string> }).cookies?.["aa_cart"];
  if (customer) {
    const found = await db.select().from(carts).where(eq(carts.customerId, customer.id)).limit(1);
    if (found[0]) return { cart: found[0], customer };
  }
  if (sessionKey) {
    const found = await db.select().from(carts).where(eq(carts.sessionKey, sessionKey)).limit(1);
    if (found[0]) return { cart: found[0], customer };
  }
  sessionKey = randomUUID().replace(/-/g, "").slice(0, 32);
  const inserted = await db.insert(carts).values({ sessionKey, customerId: customer?.id ?? null }).returning();
  const cart = inserted[0]!;
  return { cart, customer, sessionKey };
}

async function cartView(db: Db, cartId: string) {
  const items = await db.select().from(cartItems).where(eq(cartItems.cartId, cartId));
  const view = [];
  let subtotalCents = 0;
  for (const item of items) {
    const variants = await db.select().from(productVariants).where(eq(productVariants.id, item.variantId)).limit(1);
    const variant = variants[0];
    if (!variant) continue;
    const availRows = await db.select().from(inventory).where(eq(inventory.variantId, variant.id)).limit(1);
    const inv = availRows[0];
    const available = inv ? inv.physical - inv.reserved : 0;
    const unitPriceCents = variant.promoPriceCents ?? variant.priceCents;
    subtotalCents += unitPriceCents * item.quantity;
    view.push({
      variantId: variant.id,
      sku: variant.sku,
      name: variant.name,
      quantity: item.quantity,
      unitPriceCents,
      totalCents: unitPriceCents * item.quantity,
      available,
    });
  }
  return { items: view, subtotalCents };
}

// Minimal routes — avoids Fastify method type issues by using reply.send() generically

/** E-mail mascarado — o log de auditoria nunca guarda o endereço completo. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "cliente";
  return `${user.slice(0, 1)}${"*".repeat(Math.max(3, user.length - 1))}@${domain}`;
}

type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  actorLabel?: string | null;
};

/**
 * Log de auditoria append-only (retensão 90 dias).
 * Falha de auditoria não derruba o acesso — mas precisa aparecer no log do servidor.
 */
/**
 * Mapeia eventos de webhook para o status do pedido. Eventos de disputa
 * não movem o pedido diretamente — a central de chargebacks cuida disso.
 */
function webhookTargetStatus(type: NormalizedWebhookEvent["type"]): OrderStatus | null {
  switch (type) {
    case "payment.approved": return "pagamento_aprovado";
    case "payment.recused": return "cancelado";
    case "payment.expired": return "cancelado";
    case "payment.refunded": return "reembolsado";
    default: return null;
  }
}

/**
 * Log de auditoria append-only (retensão 90 dias).
 * Falha de auditoria não derruba o acesso — mas precisa aparecer no log do servidor.
 */
async function writeAudit(
  db: Db,
  request: FastifyRequest,
  entry: AuditEntry,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      actorLabel: entry.actorLabel ?? null,
      ip: request.ip,
      correlationId: randomUUID(),
    });
  } catch (error) {
    request.log.warn(
      { err: error, action: entry.action },
      "falha ao gravar log de auditoria",
    );
  }
}

export async function routes(app: FastifyInstance, config: Config, db: Db) {
  // Simple GET route
  app.get("/api/test", async (request, reply) => {
    reply.send({ ok: true });
  });

  registerStorefrontRoutes(app, db);
  registerAdminRoutes(app, db);

  // ---------------------------------------------------------- Carrinho (cookie aa_cart)
  function setCartCookie(reply: { setCookie: (n: string, v: string, o: object) => void }, sessionKey: string) {
    reply.setCookie("aa_cart", sessionKey, {
      path: "/",
      httpOnly: true,
      sameSite: config.COOKIE_SAMESITE,
      secure: config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none",
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  app.get("/api/cart", async (request, reply) => {
    const { cart, sessionKey } = await getCart(db, request as never);
    if (sessionKey) setCartCookie(reply as never, sessionKey);
    const view = await cartView(db, cart.id);
    const cartRow = await db.select().from(carts).where(eq(carts.id, cart.id)).limit(1);
    reply.send({ ...view, coupon: cartRow[0]?.couponCode ?? null });
  });

  app.post("/api/cart/items", async (request, reply) => {
    const parsed = cartItemSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
      return;
    }
    const { cart, sessionKey } = await getCart(db, request as never);
    const variants = await db.select().from(productVariants).where(eq(productVariants.id, parsed.data.variantId)).limit(1);
    if (!variants[0]) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Variante não encontrada" } });
      return;
    }
    const invRows = await db.select().from(inventory).where(eq(inventory.variantId, parsed.data.variantId)).limit(1);
    const inv = invRows[0];
    if (inv && inv.physical - inv.reserved < parsed.data.quantity) {
      reply.status(409);
      reply.send({ error: { code: "insufficient_stock", message: "Estoque insuficiente", available: inv.physical - inv.reserved } });
      return;
    }
    const existing = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
    const line = existing.find((i) => i.variantId === parsed.data.variantId);
    if (line) {
      await db.update(cartItems).set({ quantity: parsed.data.quantity }).where(eq(cartItems.id, line.id));
    } else {
      await db.insert(cartItems).values({ id: randomUUID(), cartId: cart.id, variantId: parsed.data.variantId, quantity: parsed.data.quantity });
    }
    if (sessionKey) setCartCookie(reply as never, sessionKey);
    reply.send(await cartView(db, cart.id));
  });

  app.patch("/api/cart/items/:variantId", async (request, reply) => {
    const { variantId } = request.params as { variantId: string };
    const body = request.body as { quantity: number };
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Quantidade inválida" } });
      return;
    }
    const { cart, sessionKey } = await getCart(db, request as never);
    const existing = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
    const line = existing.find((i) => i.variantId === variantId);
    if (!line) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Item não está no carrinho" } });
      return;
    }
    if (quantity === 0) {
      await db.delete(cartItems).where(eq(cartItems.id, line.id));
    } else {
      await db.update(cartItems).set({ quantity }).where(eq(cartItems.id, line.id));
    }
    if (sessionKey) setCartCookie(reply as never, sessionKey);
    reply.send(await cartView(db, cart.id));
  });

  app.delete("/api/cart/items/:variantId", async (request, reply) => {
    const { variantId } = request.params as { variantId: string };
    const { cart } = await getCart(db, request as never);
    const existing = await db.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
    const line = existing.find((i) => i.variantId === variantId);
    if (!line) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Item não está no carrinho" } });
      return;
    }
    await db.delete(cartItems).where(eq(cartItems.id, line.id));
    reply.send(await cartView(db, cart.id));
  });

  app.post("/api/cart/coupon", async (request, reply) => {
    const { code } = request.body as { code: string };
    const { cart } = await getCart(db, request as never);
    const view = await cartView(db, cart.id);
    const validation = await validateCoupon(db, { code: code ?? "", subtotalCents: view.subtotalCents });
    if (!validation.valid) {
      reply.status(400);
      reply.send({ error: { code: "invalid_coupon", message: validation.message ?? "Cupom inválido" } });
      return;
    }
    await db.update(carts).set({ couponCode: code.trim().toUpperCase() }).where(eq(carts.id, cart.id));
    reply.send({ ...view, coupon: code.trim().toUpperCase(), discountCents: validation.discountCents });
  });

  app.delete("/api/cart/coupon", async (request, reply) => {
    const { cart } = await getCart(db, request as never);
    await db.update(carts).set({ couponCode: null }).where(eq(carts.id, cart.id));
    reply.send(await cartView(db, cart.id));
  });

  // ---------------------------------------------------------- Frete + cupom
  app.post("/api/shipping/quote", async (request, reply) => {
    const body = request.body as { zip: string; items?: { variantId: string; quantity: number }[]; subtotalCents?: number };
    const zip = (body.zip ?? "").replace(/\D/g, "");
    if (zip.length !== 8) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "CEP inválido" } });
      return;
    }
    let subtotalCents = body.subtotalCents ?? 0;
    let weight = 0;
    if (body.items?.length) {
      for (const item of body.items) {
        const rows = await db.select().from(productVariants).where(eq(productVariants.id, item.variantId)).limit(1);
        const v = rows[0];
        if (v) {
          subtotalCents += (v.promoPriceCents ?? v.priceCents) * item.quantity;
          weight += v.weightGrams * item.quantity;
        }
      }
    }
    // Regra de frete grátis: uma fonte só — settings.free_shipping_from_cents.
    const freeShippingFromCents = await getFreeShippingFromCents(db);
    reply.send({
      options: calculateShipping({ zip, subtotalCents, totalWeightGrams: weight, freeShippingFromCents }),
      freeShippingFromCents,
    });
  });

  app.get("/api/coupons/validate", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const result = await validateCoupon(db, { code: q.code ?? "", subtotalCents: Number(q.subtotalCents ?? 0) || 0 });
    reply.send(result);
  });

  // ---------------------------------------------------------- Checkout + pedidos cliente
  // ---------------------------------------------------------- Newsletter
  app.post("/api/newsletter", async (request, reply) => {
    const body = request.body as { email?: string; source?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 254) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "E-mail inválido" } });
      return;
    }
    const source = (body.source ?? "homepage").slice(0, 40);
    await db
      .insert(newsletterSubscribers)
      .values({ email, source, consent: true })
      .onConflictDoNothing({ target: newsletterSubscribers.email });
    reply.status(201);
    reply.send({ success: true });
  });

  app.post("/api/checkout", async (request, reply) => {
    const customer = await requireCustomer(request as never);
    if (!customer) {
      reply.status(401);
      reply.send({ error: { code: "unauthorized", message: "Faça login para finalizar a compra" } });
      return;
    }
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
      return;
    }
    try {
      const result = await handleCheckout(db, parsed.data, {
        customerId: customer.id,
        ip: request.ip,
        correlationId: request.id,
      });
      reply.status(201);
      reply.send(result);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      reply.status(status);
      reply.send({
        error: {
          code: (err as { code?: string }).code ?? "internal_error",
          message: err instanceof Error ? err.message : "Erro interno",
          details: (err as { details?: unknown }).details,
        },
      });
    }
  });

  app.get("/api/orders", async (request, reply) => {
    const customer = await requireCustomer(request as never);
    if (!customer) {
      reply.status(401);
      reply.send({ error: { code: "unauthorized", message: "Não autenticado" } });
      return;
    }
    const rows = await db.select().from(orders).where(eq(orders.customerId, customer.id)).orderBy(desc(orders.createdAt));
    reply.send({ items: rows });
  });

  app.get("/api/orders/:number", async (request, reply) => {
    const customer = await requireCustomer(request as never);
    if (!customer) {
      reply.status(401);
      reply.send({ error: { code: "unauthorized", message: "Não autenticado" } });
      return;
    }
    const { number } = request.params as { number: string };
    const found = await db.select().from(orders).where(eq(orders.number, number)).limit(1);
    const order = found[0];
    if (!order || order.customerId !== customer.id) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Pedido não encontrado" } });
      return;
    }
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    reply.send({ order, items });
  });

  // ---------------------------------------------------------- Auth cliente
  /** Sessão do cliente: cookie httpOnly, 7 dias, sem token no corpo da resposta. */
  const customerCookie = (maxAgeSeconds: number) => ({
    path: "/",
    httpOnly: true,
    sameSite: config.COOKIE_SAMESITE,
    secure: config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none",
    maxAge: maxAgeSeconds,
  });

  app.post(
    "/api/auth/register",
    { preHandler: authRateLimit(registerRateLimitRule(config)) },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
        return;
      }
      const { name, email, password, cpf, phone } = parsed.data;
      const cleanCpf = cpf ? cpf.replace(/\D/g, "") : null;
      if (cleanCpf && cleanCpf.length !== 11) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "CPF deve conter 11 dígitos" } });
        return;
      }

      const existing = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
      if (existing.length > 0) {
        await writeAudit(db, request, {
          action: "auth.register.duplicate",
          entity: "customer",
          actorLabel: maskEmail(email),
        });
        reply.status(409);
        reply.send({ error: { code: "email_taken", message: "E-mail já cadastrado. Faça login." } });
        return;
      }

      const passwordHash = await hashPassword(password);

      // Corrida de requisições:ON CONFLICT evita 500 por e-mail duplicado.
      let inserted: (typeof customers.$inferSelect)[] = [];
      try {
        inserted = await db
          .insert(customers)
          .values({ name, email, passwordHash, cpf: cleanCpf, phone: phone || null })
          .onConflictDoNothing({ target: customers.email })
          .returning();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("duplicate key")) throw error;
        inserted = [];
      }

      const customer = inserted[0];
      if (!customer) {
        await writeAudit(db, request, {
          action: "auth.register.duplicate",
          entity: "customer",
          actorLabel: maskEmail(email),
        });
        reply.status(409);
        reply.send({ error: { code: "email_taken", message: "E-mail já cadastrado. Faça login." } });
        return;
      }

      const token = await signJwt({ sub: customer.id, role: "customer", type: "customer" });
      reply.setCookie("aa_customer", token, customerCookie(60 * 60 * 24 * 7));
      await writeAudit(db, request, {
        action: "auth.register",
        entity: "customer",
        entityId: customer.id,
        actorLabel: maskEmail(email),
      });
      reply.status(201);
      reply.send({ customer: publicCustomer(customer) });
    },
  );

  app.post(
    "/api/auth/login",
    { preHandler: authRateLimit(loginRateLimitRule(config)) },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
        return;
      }
      const { email, password } = parsed.data;
      const found = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
      const customer = found[0];
      const { ok } = customer?.passwordHash
        ? await verifyPasswordDetailed(password, customer.passwordHash)
        : { ok: false };
      if (!ok || !customer) {
        await writeAudit(db, request, {
          action: "auth.login.failed",
          entity: "customer",
          actorLabel: maskEmail(email),
        });
        reply.status(401);
        reply.send({ error: { code: "unauthorized", message: "E-mail ou senha incorretos" } });
        return;
      }

      const token = await signJwt({ sub: customer.id, role: "customer", type: "customer" });
      reply.setCookie("aa_customer", token, customerCookie(60 * 60 * 24 * 7));
      await writeAudit(db, request, {
        action: "auth.login",
        entity: "customer",
        entityId: customer.id,
        actorLabel: maskEmail(email),
      });
      reply.send({ customer: publicCustomer(customer) });
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    const token = customerToken(request as never);
    if (!token) {
      reply.status(401);
      reply.send({ error: { code: "unauthorized", message: "Não autenticado" } });
      return;
    }
    try {
      const payload = await verifyJwt(token);
      if (payload.type !== "customer") throw new Error("wrong type");
      const found = await db.select().from(customers).where(eq(customers.id, payload.sub)).limit(1);
      const customer = found[0];
      if (!customer) {
        reply.status(401);
        reply.send({ error: { code: "unauthorized", message: "Não autenticado" } });
        return;
      }
      reply.send({ customer: publicCustomer(customer) });
    } catch {
      reply.status(401);
      reply.send({ error: { code: "unauthorized", message: "Token inválido ou expirado" } });
    }
  });

  // Convite de admin (B.3): aceite público controlado por token — NÃO cria admin sem convite.
  app.post(
    "/api/auth/invite/accept",
    { preHandler: authRateLimit(registerRateLimitRule(config)) },
    async (request, reply) => {
      const body = (request.body ?? {}) as { token?: string; password?: string; name?: string };
      const token = String(body.token ?? "");
      const password = String(body.password ?? "");
      if (!token || password.length < 8) {
        return reply.status(400).send({ error: { code: "invalid_input", message: "Token e senha (mín. 8 caracteres) são obrigatórios" } });
      }
      try {
        const result = await acceptInvite(db, { token, password, name: body.name });
        await writeAudit(db, request, { action: "invite.accepted", entity: "user", entityId: result.userId, actorLabel: maskEmail(result.email) });
        reply.status(201).send({ ok: true, userId: result.userId, mfaSetupRequired: true });
      } catch (e: any) {
        reply.status(e?.status ?? 400).send({ error: { code: e?.code ?? "invite_invalid", message: e?.message || "Convite inválido" } });
      }
    },
  );

  app.post("/api/auth/admin-logout", async (request, reply) => {
    const presented = (request.cookies as any)?.[ADMIN_SESSION_COOKIE];
    if (presented) {
      try {
        await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.tokenHash, hashToken(String(presented))));
      } catch {}
    }
    reply.clearCookie(ADMIN_SESSION_COOKIE, {
      path: "/",
      httpOnly: true,
      sameSite: config.COOKIE_SAMESITE,
      secure: config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none",
    });
    await writeAudit(db, request, { action: "auth.admin.logout", entity: "user" });
    reply.send({ success: true });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    reply.clearCookie("aa_customer", {
      path: "/",
      httpOnly: true,
      sameSite: config.COOKIE_SAMESITE,
      secure: config.NODE_ENV === "production" || config.COOKIE_SAMESITE === "none",
    });
    await writeAudit(db, request, { action: "auth.logout", entity: "customer" });
    reply.send({ success: true });
  });

  // ---------------------------------------------------------- Auth admin (users)
  //
  // Sessão do painel: cookie HttpOnly e NADA no corpo da resposta. Token no
  // corpo vira accessible ao JavaScript da página (superfície de XSS) sem
  // ganhar nada — o cookie HttpOnly não é lido por script.
  app.post(
    "/api/auth/admin-login",
    { preHandler: authRateLimit(adminLoginRateLimitRule(config)) },
    async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
      return;
    }
    const { email, password } = parsed.data;
    const keys = lockoutKeys(email, request.ip);
    if (await isLocked(db, keys)) {
      await writeAudit(db, request, { action: "auth.admin.login.locked", entity: "user", actorLabel: maskEmail(email) });
      reply.status(401);
      reply.send({ error: { code: "unauthorized", message: "E-mail ou senha incorretos" } });
      return;
    }
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found[0];
    const verification = user?.passwordHash
      ? await verifyPasswordDetailed(password, user.passwordHash)
      : { ok: false as const };
    if (!user || !user.active || !verification.ok) {
      await registerFailure(db, keys);
      await writeAudit(db, request, {
        action: "auth.admin.login.failed",
        entity: "user",
        entityId: user?.id ?? null,
        actorLabel: maskEmail(email),
      });
      reply.status(401);
      reply.send({ error: { code: "unauthorized", message: "E-mail ou senha incorretos" } });
      return;
    }
    await registerSuccess(db, keys);
    // Rehash transparente: bcrypt legado → argon2id no primeiro login bem-sucedido.
    if (verification.rehash) {
      await db.update(users).set({ passwordHash: verification.rehash }).where(eq(users.id, user.id));
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    // Rotação no login: revoga sessão anterior apresentada (se houver) e emite nova.
    const presented = (request.cookies as any)?.[ADMIN_SESSION_COOKIE];
    if (presented) {
      try {
        await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.tokenHash, hashToken(String(presented))));
      } catch { /* best-effort */ }
    }
    // B.7: login em dispositivo novo → outbox na mesma transação da sessão.
    const ua = (request.headers["user-agent"] as string | undefined) ?? null;
    const priorSameDevice = ua
      ? await db.select({ id: schema.sessions.id }).from(schema.sessions).where(and(eq(schema.sessions.userId, user.id), eq(schema.sessions.userAgent, ua))).limit(1)
      : [];
    const isNewDevice = priorSameDevice.length === 0;
    const session = await (db as any).transaction(async (tx: any) => {
      const s = await createSession(tx, {
        userId: user.id,
        ip: request.ip,
        userAgent: ua,
        mfaVerified: false,
      });
      if (isNewDevice) {
        await outboxNotify(tx, loginNewDeviceBody({ email: user.email, ip: request.ip, userAgent: ua }));
      }
      return s;
    });
    reply.setCookie(ADMIN_SESSION_COOKIE, session.token, adminSessionCookieOptions(config.NODE_ENV === "production"));
    await writeAudit(db, request, {
      action: "auth.admin.login",
      entity: "user",
      entityId: user.id,
      actorLabel: maskEmail(email),
    });
    // Cookie opaco define a sessão — nada sensível no corpo.
    reply.send({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      mfaRequired: !!user.mfaEnabled,
      mfaSetupRequired: !user.mfaEnabled,
    });
  });

  // ---------------------------------------------------------- Admin clientes
  app.get(
    "/api/admin/customers",
    { preHandler: [authMiddleware, adminGuard("customers", "read")] },
    async (request, reply) => {
      const q = request.query as Record<string, string | undefined>;
      const term = (q.q ?? "").trim();
      const query = db.select().from(customers).orderBy(desc(customers.createdAt)).$dynamic();
      if (term) {
        query.where(sql`${customers.name} ILIKE ${`%${term}%`} OR ${customers.email} ILIKE ${`%${term}%`}`);
      }
      const rows = await query.limit(200);
      reply.send({ items: rows.map(publicCustomer), total: rows.length });
    },
  );

  app.get(
    "/api/admin/customers/:id",
    { preHandler: [authMiddleware, adminGuard("customers", "read")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const found = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
      if (!found[0]) {
        reply.status(404);
        reply.send({ error: { code: "not_found", message: "Cliente não encontrado" } });
        return;
      }
      reply.send({ customer: publicCustomer(found[0]) });
    },
  );

  app.post(
    "/api/admin/customers",
    { preHandler: [authMiddleware, adminGuard("customers", "create")] },
    async (request, reply) => {
      const parsed = adminCustomerSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
        return;
      }
      const { name, email, password, cpf, phone, notes } = parsed.data;
      const existing = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
      if (existing.length > 0) {
        reply.status(409);
        reply.send({ error: { code: "email_taken", message: "E-mail já cadastrado" } });
        return;
      }
      const passwordHash = password ? await hashPassword(password) : null;
      const inserted = await db
        .insert(customers)
        .values({
          name,
          email,
          passwordHash,
          cpf: cpf ? cpf.replace(/\D/g, "") : null,
          phone: phone || null,
          notes: notes || null,
        })
        .returning();
      const created = inserted[0];
      if (!created) {
        reply.status(500);
        reply.send({ error: { code: "internal_error", message: "Falha ao cadastrar cliente" } });
        return;
      }
      await db
        .insert(auditLogs)
        .values({ action: "customer.created", entity: "customers", entityId: created.id });
      reply.status(201);
      reply.send({ customer: publicCustomer(created) });
    },
  );

  // ---------------------------------------------------------- Admin métricas
  app.get(
    "/api/admin/metrics",
    { preHandler: [authMiddleware, adminGuard("dashboard", "read")] },
    async (request, reply) => {
      const [oTotal, oApproved, pTotal, lowStock, cbTotal] = await Promise.all([
        db.select({ value: count() }).from(orders),
        db.select({ value: count() }).from(orders).where(eq(orders.status, "pagamento_aprovado")),
        db.select({ value: count() }).from(products).where(eq(products.published, true)),
        db.select().from(inventory).where(sql`${inventory.physical} - ${inventory.reserved} <= ${inventory.minQuantity}`),
        db.select({ value: count() }).from(payments).where(eq(payments.status, "chargeback")),
      ]);
      const revenueRows = await db.select({ total: orders.totalCents }).from(orders).where(eq(orders.status, "pagamento_aprovado"));
      const revenueCents = revenueRows.reduce((a, r) => a + r.total, 0);
      // Valor contestado vem da disputa registrada (chargebacks), não de chute.
      const cbAmountRows = await db
        .select({ amount: chargebacks.amountCents })
        .from(chargebacks);
      const chargebackAmountCents = cbAmountRows.reduce((a, r) => a + r.amount, 0);
      // Comparação dia a dia — contagem real no banco, nada chutado no painel.
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000);
      const [todayCount, yesterdayCount, todayRevenue] = await Promise.all([
        db.select({ value: count() }).from(orders).where(gte(orders.createdAt, startToday)),
        db
          .select({ value: count() })
          .from(orders)
          .where(and(gte(orders.createdAt, startYesterday), lt(orders.createdAt, startToday))),
        db
          .select({ total: orders.totalCents })
          .from(orders)
          .where(and(eq(orders.status, "pagamento_aprovado"), gte(orders.createdAt, startToday))),
      ]);
      reply.send({
        ordersTotal: Number(oTotal[0]?.value ?? 0),
        ordersApproved: Number(oApproved[0]?.value ?? 0),
        ordersToday: Number(todayCount[0]?.value ?? 0),
        ordersYesterday: Number(yesterdayCount[0]?.value ?? 0),
        revenueTodayCents: todayRevenue.reduce((a, r) => a + r.total, 0),
        productsPublished: Number(pTotal[0]?.value ?? 0),
        lowStock: lowStock.length,
        chargebacks: Number(cbTotal[0]?.value ?? 0),
        chargebackAmountCents,
        revenueCents,
        ticketCents: revenueRows.length ? Math.floor(revenueCents / revenueRows.length) : 0,
      });
    },
  );

  // ---------------------------------------------------------- Admin produtos
  app.get(
    "/api/admin/products",
    { preHandler: [authMiddleware, adminGuard("products", "read")] },
    async (request, reply) => {
      const role = normalizeRole((request as any).user?.role);
      const showCost = canSeeCost(role);
      const rows = await db.select().from(products).orderBy(desc(products.createdAt));
      const items = await Promise.all(
        rows.map(async (row) => {
          const variants = await db.select().from(productVariants).where(eq(productVariants.productId, row.id));
          const p: any = { ...row, variants };
          if (!showCost) delete p.costCents;
          return p;
        }),
      );
      reply.send({ items });
    },
  );

  app.post(
    "/api/admin/products",
    { preHandler: [authMiddleware, adminGuard("products", "create")] },
    async (request, reply) => {
      const parsed = productSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
        return;
      }
      const data = parsed.data;
      const role = normalizeRole((request as any).user?.role);
      const actorId = (request as any).user?.sub ?? null;
      const actorLabel = (request as any).user?.email ?? role ?? null;
      const condicao = (data as any).condicao ?? "novo";
      const estadoConservacao = String((data as any).estadoConservacao ?? "").trim();
      if ((condicao === "usado" || condicao === "seminovo") && !estadoConservacao) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Produtos usados/seminovos exigem estado de conservação." } });
        return;
      }
      const costCents = canSeeCost(role) ? ((data as any).costCents ?? null) : null;
      if (costCents != null && costCents < 0) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Custo não pode ser negativo." } });
        return;
      }
      const videos = Array.isArray((data as any).videos) ? (data as any).videos : [];
      const technical = (data as any).technical && typeof (data as any).technical === "object" ? (data as any).technical : {};
      const publishedAt = data.published ? new Date() : null;
      try {
        // FASE3-ATOMIC-PRODUCT: produto+variantes+invent?rio+hist?rico+auditoria em transa??o ?nica
        const { product, variants } = await (db as any).transaction(async (tx: any) => {
          const [product] = await tx
            .insert(products)
            .values({
              name: data.name,
              slug: data.slug,
              description: data.description,
              shortDescription: (data as any).shortDescription ?? "",
              categoryId: data.categoryId,
              brandId: data.brandId ?? null,
              ageRestricted: data.ageRestricted,
              featured: data.featured,
              published: data.published,
              condicao,
              estadoConservacao,
              acessoriosIncluidos: String((data as any).acessoriosIncluidos ?? ""),
              garantiaDias: Number.isFinite((data as any).garantiaDias) ? Math.max(0, (data as any).garantiaDias | 0) : 30,
              tags: String((data as any).tags ?? ""),
              seoTitle: String((data as any).seoTitle ?? ""),
              seoDescription: String((data as any).seoDescription ?? ""),
              technical,
              videos,
              costCents,
              publishedAt,
            } as any)
            .returning();
          if (!product) throw new Error("product insert failed");
          const variants = [];
          for (const v of data.variants) {
            const [variant] = await tx
              .insert(productVariants)
              .values({
                productId: product.id,
                sku: v.sku,
                name: v.name,
                priceCents: v.priceCents,
                promoPriceCents: v.promoPriceCents ?? null,
                weightGrams: v.weightGrams,
                active: v.active,
              })
              .returning();
            if (!variant) continue;
            const existing = await tx.select().from(inventory).where(eq(inventory.variantId, variant.id));
            if (!existing[0]) {
              await tx.insert(inventory).values({
                variantId: variant.id,
                physical: v.stockPhysical,
                reserved: 0,
                minQuantity: v.stockMin,
              });
            }
            variants.push(variant);
          }
          await tx.insert(auditLogs).values({ actorUserId: actorId, action: "product.created", entity: "products", entityId: product.id } as any);
          await appendProductHistory(tx, [
            { productId: product.id, actorUserId: actorId, actorLabel, field: "created", beforeValue: null, afterValue: { slug: data.slug, condicao } },
            ...(data.published ? [{ productId: product.id, actorUserId: actorId, actorLabel, field: "published", beforeValue: false, afterValue: true }] : []),
          ]);
          return { product, variants };
        });
        const out: any = { ...product, variants };
        if (!canSeeCost(role)) delete out.costCents;
        reply.status(201);
        reply.send({ product: out });
      } catch (err: any) {
        const msg = String(err?.cause?.message || err?.message || "");
        if (/unique|duplicate/i.test(msg)) {
          reply.status(409);
          reply.send({ error: { code: "conflict", message: "Slug ou SKU já existe." } });
          return;
        }
        throw err;
      }
    },
  );

  app.patch(
    "/api/admin/products/:id",
    { preHandler: [authMiddleware, adminGuard("products", "update")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, any>;
      const found = await db.select().from(products).where(eq(products.id, id)).limit(1);
      if (!found[0]) {
        reply.status(404);
        reply.send({ error: { code: "not_found", message: "Produto n?o encontrado" } });
        return;
      }
      const before = found[0] as any;
      const role = normalizeRole((request as any).user?.role);
      const actorId = (request as any).user?.sub ?? null;
      const actorLabel = (request as any).user?.email ?? role ?? null;
      const set: Record<string, any> = {};
      if (body.archived === true) { body.published = false; body.featured = false; }
      if (body.name !== undefined) set.name = String(body.name).trim().slice(0, 160);
      if (body.slug !== undefined) set.slug = String(body.slug).trim();
      if (body.description !== undefined) set.description = String(body.description);
      if (body.shortDescription !== undefined) set.shortDescription = String(body.shortDescription).slice(0, 500);
      if (body.categoryId !== undefined) set.categoryId = body.categoryId;
      if (body.brandId !== undefined) set.brandId = body.brandId || null;
      if (body.ageRestricted !== undefined) set.ageRestricted = !!body.ageRestricted;
      if (body.featured !== undefined) set.featured = !!body.featured;
      if (body.tags !== undefined) set.tags = String(body.tags).slice(0, 500);
      if (body.seoTitle !== undefined) set.seoTitle = String(body.seoTitle).slice(0, 200);
      if (body.seoDescription !== undefined) set.seoDescription = String(body.seoDescription).slice(0, 320);
      if (body.acessoriosIncluidos !== undefined) set.acessoriosIncluidos = String(body.acessoriosIncluidos).slice(0, 1000);
      if (body.garantiaDias !== undefined) {
        const g = Number(body.garantiaDias);
        if (!Number.isFinite(g) || g < 0) { reply.status(400); reply.send({ error: { code: "invalid_input", message: "Garantia n?o pode ser negativa." } }); return; }
        set.garantiaDias = g | 0;
      }
      if (body.condicao !== undefined) {
        const c = String(body.condicao);
        if (!["novo","usado","seminovo"].includes(c)) { reply.status(400); reply.send({ error: { code: "invalid_input", message: "Condi??o inv?lida." } }); return; }
        set.condicao = c;
      }
      if (body.estadoConservacao !== undefined) set.estadoConservacao = String(body.estadoConservacao).slice(0, 120);
      if (body.technical !== undefined && body.technical && typeof body.technical === "object") set.technical = body.technical;
      if (body.videos !== undefined) {
        if (!Array.isArray(body.videos)) { reply.status(400); reply.send({ error: { code: "invalid_input", message: "V?deos inv?lidos." } }); return; }
        const okTypes = new Set(["youtube","vimeo","mp4","external"]);
        for (const v of body.videos) {
          if (!v || typeof v.url !== "string" || !/^https?:\/\//i.test(v.url)) { reply.status(400); reply.send({ error: { code: "invalid_input", message: "URL de v?deo inv?lida." } }); return; }
          if (!okTypes.has(String(v.type || ""))) { reply.status(400); reply.send({ error: { code: "invalid_input", message: "Tipo de v?deo inv?lido." } }); return; }
        }
        set.videos = body.videos;
      }
      if (body.costCents !== undefined) {
        if (!canSeeCost(role)) { reply.status(403); reply.send({ error: { code: "forbidden", message: "Sem permiss?o para editar custo interno." } }); return; }
        if (body.costCents !== null && (typeof body.costCents !== "number" || !Number.isFinite(body.costCents) || body.costCents < 0)) {
          reply.status(400); reply.send({ error: { code: "invalid_input", message: "Custo n?o pode ser negativo." } }); return;
        }
        set.costCents = body.costCents === null ? null : (body.costCents | 0);
      }
      if (body.publishedAt !== undefined) set.publishedAt = body.publishedAt ? new Date(body.publishedAt) : null;
      if (body.published !== undefined) {
        set.published = !!body.published;
        if (set.published && before.publishedAt == null && body.publishedAt === undefined) set.publishedAt = new Date();
      }
      const finalCond = set.condicao ?? before.condicao ?? "novo";
      const finalCons = String(set.estadoConservacao ?? before.estadoConservacao ?? "").trim();
      if ((finalCond === "usado" || finalCond === "seminovo") && !finalCons) {
        reply.status(400); reply.send({ error: { code: "invalid_input", message: "Produtos usados/seminovos exigem estado de conserva??o." } }); return;
      }
      if (Object.keys(set).length === 0) { const o:any={...before}; if(!canSeeCost(role)) delete o.costCents; reply.send({ product: o }); return; }
      try {
        const [updated] = await db.update(products).set(set as any).where(eq(products.id, id)).returning();
        const after = updated as any;
        const hist: any[] = [];
        for (const f of ["published","featured","costCents","publishedAt","slug","condicao","estadoConservacao","name"]) {
          if (f in set) hist.push({ productId: id, actorUserId: actorId, actorLabel, field: f, beforeValue: before[f], afterValue: after[f] });
        }
        if (body.archived === true) hist.push({ productId: id, actorUserId: actorId, actorLabel, field: "archived", beforeValue: false, afterValue: true });
        await appendProductHistory(db, hist);
        const pubChanged = "published" in set && !!before.published !== !!after.published;
        await db.insert(auditLogs).values({ actorUserId: actorId, action: pubChanged ? (after.published ? "product.published" : "product.unpublished") : (body.archived ? "product.archived" : "product.updated"), entity: "products", entityId: id } as any);
        const o:any={...after}; if(!canSeeCost(role)) delete o.costCents; reply.send({ product: o });
      } catch (err: any) {
        const msg = String(err?.cause?.message || err?.message || "");
        if (/unique|duplicate/i.test(msg)) { reply.status(409); reply.send({ error: { code: "conflict", message: "Slug ou SKU j? existe." } }); return; }
        throw err;
      }
    },
  );
  // ---------------------------------------------------------- Admin estoque
  app.get(
    "/api/admin/inventory",
    { preHandler: [authMiddleware, adminGuard("inventory", "read")] },
    async (request, reply) => {
      const rows = await db.select().from(inventory).orderBy(asc(inventory.variantId));
      const items = await Promise.all(
        rows.map(async (row) => {
          const variants = await db.select().from(productVariants).where(eq(productVariants.id, row.variantId)).limit(1);
          const v = variants[0];
          return { ...row, available: row.physical - row.reserved, sku: v?.sku ?? "", name: v?.name ?? "" };
        }),
      );
      reply.send({ items });
    },
  );

  app.post(
    "/api/admin/inventory/movements",
    { preHandler: [authMiddleware, adminGuard("inventory", "update")] },
    async (request, reply) => {
      const parsed = stockMovementSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Dados inválidos", details: parsed.error.flatten() } });
        return;
      }
      try {
        const actorId = (request as { user?: { sub: string } }).user?.sub ?? null;
        await (db as any).transaction(async (tx: any) => {
          await adjustStockInTx(tx, {
            variantId: parsed.data.variantId,
            type: parsed.data.type,
            quantity: parsed.data.quantity,
            reason: parsed.data.reason,
            userId: actorId ?? undefined,
          });
          await tx.insert(auditLogs).values({
            actorUserId: actorId,
            action: "stock.movement",
            entity: "inventory",
            entityId: parsed.data.variantId,
          } as any);
        });
        reply.send({ ok: true });
      } catch (err) {
        reply.status((err as { status?: number }).status ?? 400);
        reply.send({ error: { code: (err as { code?: string }).code ?? "bad_request", message: err instanceof Error ? err.message : "Erro" } });
      }
    },
  );

  // ---------------------------------------------------------- Admin pedidos
  app.get(
    "/api/admin/orders",
    { preHandler: [authMiddleware, adminGuard("orders", "read")] },
    async (request, reply) => {
      const rows = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(200);
      const items = await Promise.all(
        rows.map(async (row) => {
          const found = await db
            .select({ name: customers.name, email: customers.email })
            .from(customers)
            .where(eq(customers.id, row.customerId))
            .limit(1);
          return { ...row, customerName: found[0]?.name ?? "Cliente", customerEmail: found[0]?.email ?? "" };
        }),
      );
      reply.send({ items });
    },
  );

  app.post(
    "/api/admin/orders/:id/transition",
    { preHandler: [authMiddleware, adminGuard("orders", "update")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = orderStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        reply.send({ error: { code: "invalid_input", message: "Dados inválidos" } });
        return;
      }
      const found = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      const order = found[0];
      if (!order) {
        reply.status(404);
        reply.send({ error: { code: "not_found", message: "Pedido não encontrado" } });
        return;
      }
      if (!canTransition(order.status, parsed.data.status)) {
        reply.status(409);
        reply.send({ error: { code: "invalid_transition", message: `Transição ${order.status} → ${parsed.data.status} não permitida` } });
        return;
      }
      await db.update(orders).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(orders.id, id));
      reply.send({ order: { ...order, status: parsed.data.status } });
    },
  );

  // Admin health — protegido como as demais rotas de admin
  app.get("/api/admin/health", { preHandler: [authMiddleware, adminGuard("dashboard", "read")] }, async (request, reply) => {
    reply.send({ status: "ok" });
  });

  return app;
}

export type { Config };
