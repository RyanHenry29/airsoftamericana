import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { adminGuard } from "../lib/rbac.js";
import { csrfTokenFor } from "../lib/csrf.js";
import { listActiveSessions, revokeSession } from "../services/sessions.js";
import { normalizeRole, type Role } from "../lib/rbac.js";
import { createInvite } from "../services/invites.js";
import { outboxNotify, roleChangedBody, bulkPriceBody } from "../services/outbox.js";
import { listAudit } from "../lib/audit.js";

/** Request com o payload do JWT anexado pelo authMiddleware. */
type AdminRequest = FastifyRequest & { user?: { sub?: string; role?: string } };

type BannerInput = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  ctaLabel?: string;
  imageDesktop?: string | null;
  imageMobile?: string | null;
  link?: string | null;
  kind?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  active?: boolean;
  position?: number;
};

type SectionInput = {
  kind: string;
  title?: string;
  subtitle?: string;
  position?: number;
  active?: boolean;
  config?: Record<string, unknown>;
};

type CategoryInput = {
  name: string;
  slug: string;
  parentId?: string | null;
  description?: string;
  imageUrl?: string | null;
  ageRestricted?: boolean;
  active?: boolean;
  position?: number;
};

type BrandInput = {
  name: string;
  slug: string;
  logoUrl?: string | null;
  description?: string;
  active?: boolean;
  position?: number;
};

function actorOf(request: FastifyRequest): string | null {
  const user = (request as AdminRequest).user;
  return user?.sub ?? null;
}

/**
 * Painel administrativo — CMS, catálogo e operação.
 * Toda mutação persiste e deixa rastro em audit_logs.
 */
export function registerAdminRoutes(app: FastifyInstance, db: Db): void {
  const A = authMiddleware; // compat; cada rota declara adminGuard(mod,act)

  const audit = async (
    request: FastifyRequest,
    action: string,
    entity: string,
    entityId?: string,
  ): Promise<void> => {
    await db.insert(schema.auditLogs).values({
      actorUserId: actorOf(request),
      action,
      entity,
      entityId: entityId ?? null,
      ip: request.ip ?? null,
      correlationId: request.id ?? null,
    });
  };

  // ---------------------------------------------------------------- CSRF (B.3/B.1)
  app.get("/api/admin/csrf", { preHandler: [A, adminGuard("dashboard", "read")] }, async (request, reply) => {
    // Mesma função que a guarda confere: HMAC do valor do cookie de sessão.
    const cookies = (request as any).cookies;
    const raw = cookies?.aa_session ? String(cookies.aa_session) : "";
    reply.send({ token: raw ? csrfTokenFor(raw) : null });
  });

  // ---------------------------------------------------------------- Sessões (B.1)
  app.get("/api/admin/sessions", { preHandler: [A, adminGuard("users", "read")] }, async (request, reply) => {
    const user = (request as any).user as { sub: string };
    const session = (request as any).session as { id: string };
    const items = await listActiveSessions(db, user.sub);
    reply.send({ items: items.map((s) => ({ ...s, current: s.id === session.id })) });
  });

  app.delete("/api/admin/sessions/:id", { preHandler: [A, adminGuard("users", "update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = (request as any).user as { sub: string; role: string };
    const actorSession = (request as any).session as { id: string };
    const isSelf = id === actorSession.id;
    if (!isSelf) {
      const role = normalizeRole(actor.role);
      if (role !== "superadmin") return reply.status(403).send({ error: { code: "forbidden", message: "Só superadmin revoga sessões de outros usuários" } });
    }
    const ok = await revokeSession(db, id);
    if (!ok) return reply.status(404).send({ error: { code: "not_found", message: "Sessão não encontrada ou já revogada" } });
    reply.send({ revoked: true });
  });

  // ---------------------------------------------------------------- Usuários (B.7: mudança de papel → outbox na mesma transação)
  app.get("/api/admin/users", { preHandler: [A, adminGuard("users", "read")] }, async (request, reply) => {
    const actor = (request as AdminRequest).user;
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        active: schema.users.active,
        mfaEnabled: schema.users.mfaEnabled,
        needsRoleReview: schema.users.needsRoleReview,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt));
    reply.send({
      items: rows.map((r) => ({ ...r, role: normalizeRole(r.role) ?? r.role })),
      actor: {
        id: actor?.sub ?? null,
        role: normalizeRole(actor?.role) ?? actor?.role ?? null,
      },
    });
  });

  app.patch("/api/admin/users/:id", { preHandler: [A, adminGuard("users", "update")] }, async (request, reply) => {
    const actor = (request as any).user as { sub: string; role: string; email?: string };
    if (normalizeRole(actor.role) !== "superadmin") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Só superadmin altera papéis" } });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { role?: string };
    const newRole = body.role ? String(body.role) : "";
    if (!normalizeRole(newRole)) return reply.status(400).send({ error: { code: "invalid_input", message: "Papel inválido" } });
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!target) return reply.status(404).send({ error: { code: "not_found", message: "Usuário não encontrado" } });
    const from = target.role;
    if (from === newRole) return reply.send({ user: { id, role: newRole } });
    await (db as any).transaction(async (tx: any) => {
      await tx.update(schema.users).set({ role: newRole }).where(eq(schema.users.id, id));
      await tx.insert(schema.auditLogs).values({ action: "user.role_changed", entity: "users", entityId: id, actorUserId: actor.sub, after: { from, to: newRole } });
      await outboxNotify(tx, roleChangedBody({ targetEmail: target.email, from, to: newRole, by: actor.email ?? actor.sub }));
    });
    reply.send({ user: { id, role: newRole } });
  });

  // ---------------------------------------------------------------- Convites (B.3) — só superadmin
  app.post("/api/admin/invites", { preHandler: [A, adminGuard("users", "create")] }, async (request, reply) => {
    const actor = (request as any).user as { sub: string; role: string };
    if (normalizeRole(actor.role) !== "superadmin") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Só superadmin cria convites" } });
    }
    const body = (request.body ?? {}) as { email?: string; role?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = body.role as Role;
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "E-mail inválido" } });
    }
    try {
      const invite = await createInvite(db, { email, role, createdBy: actor.sub });
      await db.insert(schema.auditLogs).values({ action: "invite.created", entity: "admin_invites", entityId: invite.id, actorLabel: email });
      // token cru retornado uma única vez
      reply.status(201).send({ invite: { id: invite.id, email, role, expiresAt: invite.expiresAt, token: invite.token } });
    } catch (e: any) {
      reply.status(e?.status ?? 400).send({ error: { code: e?.code ?? "invalid_input", message: e?.message || "Falha ao criar convite" } });
    }
  });
  app.get("/api/admin/banners", { preHandler: [A, adminGuard("banners","read")] }, async (_request, reply) => {
    const rows = await db.select().from(schema.banners).orderBy(asc(schema.banners.position));
    reply.send({ items: rows });
  });

  app.post("/api/admin/banners", { preHandler: [A, adminGuard("banners","create")] }, async (request, reply) => {
    const body = request.body as BannerInput;
    if (!body?.title) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Título é obrigatório" } });
      return;
    }
    const [row] = await db
      .insert(schema.banners)
      .values({
        title: body.title,
        subtitle: body.subtitle ?? "",
        eyebrow: body.eyebrow ?? "",
        ctaLabel: body.ctaLabel ?? "",
        imageDesktop: body.imageDesktop ?? null,
        imageMobile: body.imageMobile ?? null,
        link: body.link ?? null,
        kind: body.kind ?? "hero",
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        active: body.active ?? true,
        position: body.position ?? 0,
      })
      .returning();
    await audit(request, "banner.created", "banners", row?.id);
    reply.status(201);
    reply.send({ banner: row });
  });

  app.patch("/api/admin/banners/:id", { preHandler: [A, adminGuard("banners","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<BannerInput>;
    const [row] = await db
      .update(schema.banners)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.subtitle !== undefined ? { subtitle: body.subtitle } : {}),
        ...(body.eyebrow !== undefined ? { eyebrow: body.eyebrow } : {}),
        ...(body.ctaLabel !== undefined ? { ctaLabel: body.ctaLabel } : {}),
        ...(body.imageDesktop !== undefined ? { imageDesktop: body.imageDesktop } : {}),
        ...(body.imageMobile !== undefined ? { imageMobile: body.imageMobile } : {}),
        ...(body.link !== undefined ? { link: body.link } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.startsAt !== undefined ? { startsAt: body.startsAt ? new Date(body.startsAt) : null } : {}),
        ...(body.endsAt !== undefined ? { endsAt: body.endsAt ? new Date(body.endsAt) : null } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      })
      .where(eq(schema.banners.id, id))
      .returning();
    if (!row) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Banner não encontrado" } });
      return;
    }
    await audit(request, "banner.updated", "banners", id);
    reply.send({ banner: row });
  });

  app.delete("/api/admin/banners/:id", { preHandler: [A, adminGuard("banners","delete")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(schema.banners).where(eq(schema.banners.id, id));
    await audit(request, "banner.deleted", "banners", id);
    reply.send({ ok: true });
  });

  // ---------------------------------------------------------------- Seções da homepage
  app.get("/api/admin/homepage-sections", { preHandler: [A, adminGuard("homepage","read")] }, async (_request, reply) => {
    const rows = await db
      .select()
      .from(schema.homepageSections)
      .orderBy(asc(schema.homepageSections.position));
    reply.send({ items: rows });
  });

  app.post("/api/admin/homepage-sections", { preHandler: [A, adminGuard("homepage","create")] }, async (request, reply) => {
    const body = request.body as SectionInput;
    if (!body?.kind) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Tipo da seção é obrigatório" } });
      return;
    }
    const [row] = await db
      .insert(schema.homepageSections)
      .values({
        kind: body.kind,
        title: body.title ?? "",
        subtitle: body.subtitle ?? "",
        position: body.position ?? 0,
        active: body.active ?? true,
        config: (body.config ?? {}) as Record<string, unknown>,
      })
      .returning();
    await audit(request, "homepage_section.created", "homepage_sections", row?.id);
    reply.status(201);
    reply.send({ section: row });
  });

  app.patch("/api/admin/homepage-sections/:id", { preHandler: [A, adminGuard("homepage","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<SectionInput>;
    const [row] = await db
      .update(schema.homepageSections)
      .set({
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.subtitle !== undefined ? { subtitle: body.subtitle } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.config !== undefined ? { config: body.config as Record<string, unknown> } : {}),
      })
      .where(eq(schema.homepageSections.id, id))
      .returning();
    if (!row) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Seção não encontrada" } });
      return;
    }
    await audit(request, "homepage_section.updated", "homepage_sections", id);
    reply.send({ section: row });
  });

  app.post("/api/admin/homepage-sections/reorder", { preHandler: [A, adminGuard("homepage","update")] }, async (request, reply) => {
    const body = request.body as { ids?: string[] };
    const ids = body?.ids ?? [];
    for (const [index, id] of ids.entries()) {
      await db
        .update(schema.homepageSections)
        .set({ position: index })
        .where(eq(schema.homepageSections.id, id));
    }
    await audit(request, "homepage_section.reordered", "homepage_sections");
    reply.send({ ok: true, count: ids.length });
  });

  app.delete("/api/admin/homepage-sections/:id", { preHandler: [A, adminGuard("homepage","delete")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.delete(schema.homepageSections).where(eq(schema.homepageSections.id, id));
    await audit(request, "homepage_section.deleted", "homepage_sections", id);
    reply.send({ ok: true });
  });

  // ---------------------------------------------------------------- Categorias
  app.get("/api/admin/categories", { preHandler: [A, adminGuard("categories","read")] }, async (_request, reply) => {
    const rows = await db
      .select()
      .from(schema.categories)
      .orderBy(asc(schema.categories.position), asc(schema.categories.name));
    const tree = rows
      .filter((c) => !c.parentId)
      .map((root) => ({
        ...root,
        children: rows
          .filter((c) => c.parentId === root.id)
          .map((c) => ({ ...c, children: rows.filter((g) => g.parentId === c.id) })),
      }));
    reply.send({ items: tree, total: rows.length });
  });

  app.post("/api/admin/categories", { preHandler: [A, adminGuard("categories","create")] }, async (request, reply) => {
    const body = request.body as CategoryInput;
    if (!body?.name || !body?.slug) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Nome e slug são obrigatórios" } });
      return;
    }
    const [row] = await db
      .insert(schema.categories)
      .values({
        name: body.name,
        slug: body.slug,
        parentId: body.parentId ?? null,
        description: body.description ?? "",
        imageUrl: body.imageUrl ?? null,
        ageRestricted: body.ageRestricted ?? false,
        active: body.active ?? true,
        position: body.position ?? 0,
      })
      .returning();
    await audit(request, "category.created", "categories", row?.id);
    reply.status(201);
    reply.send({ category: row });
  });

  app.patch("/api/admin/categories/:id", { preHandler: [A, adminGuard("categories","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<CategoryInput>;
    const [row] = await db
      .update(schema.categories)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.ageRestricted !== undefined ? { ageRestricted: body.ageRestricted } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      })
      .where(eq(schema.categories.id, id))
      .returning();
    if (!row) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Categoria não encontrada" } });
      return;
    }
    await audit(request, "category.updated", "categories", id);
    reply.send({ category: row });
  });

  app.delete("/api/admin/categories/:id", { preHandler: [A, adminGuard("categories","delete")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const children = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.parentId, id));
    if (children.length > 0) {
      reply.status(409);
      reply.send({
        error: {
          code: "has_children",
          message: "A categoria tem subcategorias. Mova ou remova as filhas antes.",
        },
      });
      return;
    }
    await db.delete(schema.categories).where(eq(schema.categories.id, id));
    await audit(request, "category.deleted", "categories", id);
    reply.send({ ok: true });
  });

  // ---------------------------------------------------------------- Marcas
  app.get("/api/admin/brands", { preHandler: [A, adminGuard("brands","read")] }, async (_request, reply) => {
    const rows = await db
      .select()
      .from(schema.brands)
      .orderBy(asc(schema.brands.position), asc(schema.brands.name));
    reply.send({ items: rows });
  });

  app.post("/api/admin/brands", { preHandler: [A, adminGuard("brands","create")] }, async (request, reply) => {
    const body = request.body as BrandInput;
    if (!body?.name || !body?.slug) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Nome e slug são obrigatórios" } });
      return;
    }
    const [row] = await db
      .insert(schema.brands)
      .values({
        name: body.name,
        slug: body.slug,
        logoUrl: body.logoUrl ?? null,
        description: body.description ?? "",
        active: body.active ?? true,
        position: body.position ?? 0,
      })
      .returning();
    await audit(request, "brand.created", "brands", row?.id);
    reply.status(201);
    reply.send({ brand: row });
  });

  app.patch("/api/admin/brands/:id", { preHandler: [A, adminGuard("brands","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<BrandInput>;
    const [row] = await db
      .update(schema.brands)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      })
      .where(eq(schema.brands.id, id))
      .returning();
    if (!row) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Marca não encontrada" } });
      return;
    }
    await audit(request, "brand.updated", "brands", id);
    reply.send({ brand: row });
  });

  app.delete("/api/admin/brands/:id", { preHandler: [A, adminGuard("brands","delete")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const used = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.brandId, id))
      .limit(1);
    if (used.length > 0) {
      reply.status(409);
      reply.send({ error: { code: "in_use", message: "A marca tem produtos vinculados." } });
      return;
    }
    await db.delete(schema.brands).where(eq(schema.brands.id, id));
    await audit(request, "brand.deleted", "brands", id);
    reply.send({ ok: true });
  });

  // ---------------------------------------------------------------- Produto: ficha, galeria, relacionados
  // B.7: alteração de preço em massa → outbox na mesma transação
  app.post("/api/admin/products/bulk-price", { preHandler: [A, adminGuard("products", "update")] }, async (request, reply) => {
    const actor = (request as any).user as { sub: string; email?: string };
    const body = (request.body ?? {}) as { percent?: number; productIds?: string[] };
    const percent = Number(body.percent);
    if (!Number.isFinite(percent) || percent === 0 || percent < -90 || percent > 500) {
      return reply.status(400).send({ error: { code: "invalid_input", message: "percent deve ser um número != 0 entre -90 e 500" } });
    }
    const ids = Array.isArray(body.productIds) ? body.productIds.filter(Boolean) : null;
    const factor = 1 + percent / 100;
    const updated = await (db as any).transaction(async (tx: any) => {
      let variants = await tx.select().from(schema.productVariants);
      if (ids && ids.length) variants = variants.filter((v: any) => ids.includes(v.productId));
      for (const v of variants) {
        const next = Math.max(0, Math.round(v.priceCents * factor));
        await tx.update(schema.productVariants).set({ priceCents: next }).where(eq(schema.productVariants.id, v.id));
      }
      await tx.insert(schema.auditLogs).values({ action: "product.bulk_price_change", entity: "product_variants", actorUserId: actor.sub, after: { percent, count: variants.length } });
      await outboxNotify(tx, bulkPriceBody({ count: variants.length, by: actor.email ?? actor.sub, mode: `${percent}%` }));
      return variants.length;
    });
    reply.send({ ok: true, updated });
  });

  app.get("/api/admin/products/:id", { preHandler: [A, adminGuard("products","read")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.select().from(schema.products).where(eq(schema.products.id, id)).limit(1);
    const product = rows[0];
    if (!product) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Produto não encontrado" } });
      return;
    }
    const variants = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, id));
    const [images, specs, related, stock] = await Promise.all([
      db.select().from(schema.productImages).where(eq(schema.productImages.productId, id)).orderBy(asc(schema.productImages.position)),
      db.select().from(schema.productSpecs).where(eq(schema.productSpecs.productId, id)).orderBy(asc(schema.productSpecs.position)),
      db.select().from(schema.relatedProducts).where(eq(schema.relatedProducts.productId, id)),
      variants.length
        ? db
            .select()
            .from(schema.inventory)
            .where(
              inArray(
                schema.inventory.variantId,
                variants.map((v) => v.id),
              ),
            )
        : Promise.resolve([]),
    ]);
    reply.send({
      product,
      variants: variants.map((v) => ({
        ...v,
        inventory: stock.find((s) => s.variantId === v.id) ?? null,
      })),
      images,
      specs,
      related,
    });
  });

  app.post("/api/admin/products/:id/images", { preHandler: [A, adminGuard("products","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { url?: string; alt?: string; kind?: string };
    if (!body?.url) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "URL da imagem é obrigatória" } });
      return;
    }
    const existing = await db
      .select({ position: schema.productImages.position })
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, id));
    const position = existing.reduce((max, i) => Math.max(max, i.position), -1) + 1;
    const [row] = await db
      .insert(schema.productImages)
      .values({ productId: id, url: body.url, alt: body.alt ?? "", kind: body.kind ?? "image", position })
      .returning();
    await audit(request, "product.image.added", "products", id);
    reply.status(201);
    reply.send({ image: row });
  });

  app.delete("/api/admin/products/:id/images/:imageId", { preHandler: [A, adminGuard("products","update")] }, async (request, reply) => {
    const { id, imageId } = request.params as { id: string; imageId: string };
    await db.delete(schema.productImages).where(eq(schema.productImages.id, imageId));
    await audit(request, "product.image.removed", "products", id);
    reply.send({ ok: true });
  });

  app.post("/api/admin/products/:id/specs", { preHandler: [A, adminGuard("products","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { key?: string; label?: string; value?: string };
    if (!body?.label || !body?.value) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Label e value são obrigatórios" } });
      return;
    }
    const existing = await db
      .select({ position: schema.productSpecs.position })
      .from(schema.productSpecs)
      .where(eq(schema.productSpecs.productId, id));
    const position = existing.reduce((max, s) => Math.max(max, s.position), -1) + 1;
    const [row] = await db
      .insert(schema.productSpecs)
      .values({
        productId: id,
        key: (body.key ?? body.label).toLowerCase().replace(/\s+/g, "-").slice(0, 60),
        label: body.label,
        value: body.value,
        position,
      })
      .returning();
    await audit(request, "product.spec.added", "products", id);
    reply.status(201);
    reply.send({ spec: row });
  });

  app.delete("/api/admin/products/:id/specs/:specId", { preHandler: [A, adminGuard("products","update")] }, async (request, reply) => {
    const { id, specId } = request.params as { id: string; specId: string };
    await db.delete(schema.productSpecs).where(eq(schema.productSpecs.id, specId));
    await audit(request, "product.spec.removed", "products", id);
    reply.send({ ok: true });
  });

  app.post("/api/admin/products/:id/related", { preHandler: [A, adminGuard("products","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { relatedProductId?: string };
    if (!body?.relatedProductId) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "relatedProductId é obrigatório" } });
      return;
    }
    const existing = await db
      .select({ id: schema.relatedProducts.id })
      .from(schema.relatedProducts)
      .where(eq(schema.relatedProducts.productId, id));
    const position = existing.length;
    const [row] = await db
      .insert(schema.relatedProducts)
      .values({ productId: id, relatedProductId: body.relatedProductId, position })
      .onConflictDoNothing()
      .returning();
    await audit(request, "product.related.added", "products", id);
    reply.status(201);
    reply.send({ related: row ?? null });
  });

  app.delete("/api/admin/products/:id/related/:relatedId", { preHandler: [A, adminGuard("products","update")] }, async (request, reply) => {
    const { id, relatedId } = request.params as { id: string; relatedId: string };
    await db
      .delete(schema.relatedProducts)
      .where(and(eq(schema.relatedProducts.productId, id), eq(schema.relatedProducts.relatedProductId, relatedId)));
    await audit(request, "product.related.removed", "products", id);
    reply.send({ ok: true });
  });

  // ---------------------------------------------------------------- Importação CSV do catálogo
  // Formato: slug;nome;sku;preco;categorySlug (cabeçalho opcional ignorado se não bater)
  app.post("/api/admin/catalog/import", { preHandler: [A, adminGuard("products", "update")] }, async (request, reply) => {
    const body = (request.body ?? {}) as { file?: string };
    const file = String(body.file ?? "");
    const lines = file.replace(/\r\n/g, "\n").split("\n");
    const errors: Array<{ line: number; message: string }> = [];
    let created = 0;
    let updated = 0;
    const seenSkus = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? "";
      const line = raw.trim();
      if (!line) continue;
      const fields = line.split(";").map((f) => f.trim());
      // ignora cabeçalho comum
      if (i === 0 && /slug/i.test(fields[0] ?? "") && /sku/i.test(fields[2] ?? "")) continue;
      if (fields.length < 5) {
        errors.push({ line: i + 1, message: "Linha inválida: esperava pelo menos 5 campos (slug;nome;sku;preco;categorySlug)" });
        continue;
      }
      const [slug, name, sku, priceStr, categorySlug] = fields;
      if (!sku) { errors.push({ line: i + 1, message: "SKU ausente" }); continue; }
      if (seenSkus.has(sku)) { errors.push({ line: i + 1, message: `SKU duplicado no arquivo: ${sku}` }); continue; }
      seenSkus.add(sku);
      if (!slug || !name) { errors.push({ line: i + 1, message: "slug e nome são obrigatórios" }); continue; }
      const price = Number(priceStr);
      if (!Number.isFinite(price) || price < 0) { errors.push({ line: i + 1, message: "Preço inválido" }); continue; }
      const priceCents = Math.round(price * 100);

      const catRows = await db.select().from(schema.categories).where(eq(schema.categories.slug, categorySlug ?? "")).limit(1);
      const category = catRows[0];
      if (!category) { errors.push({ line: i + 1, message: `Categoria não encontrada: ${categorySlug ?? ""}` }); continue; }

      const existingVariant = await db.select().from(schema.productVariants).where(eq(schema.productVariants.sku, sku)).limit(1);
      if (existingVariant[0]) {
        await db.update(schema.productVariants).set({ priceCents, name }).where(eq(schema.productVariants.id, existingVariant[0].id));
        updated++;
      } else {
        // garante produto (por slug)
        let product = (await db.select().from(schema.products).where(eq(schema.products.slug, slug)).limit(1))[0];
        if (!product) {
          product = (await db.insert(schema.products).values({
            name, slug, description: "", categoryId: category.id, ageRestricted: false, featured: false, published: false,
          }).returning())[0];
        }
        await db.insert(schema.productVariants).values({
          productId: product!.id, sku, name, priceCents, promoPriceCents: null, weightGrams: 0, active: true,
        } as any);
        const inv = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, (await db.select().from(schema.productVariants).where(eq(schema.productVariants.sku, sku)).limit(1))[0]!.id)).limit(1);
        // inventory criado sob demanda em outros fluxos; aqui mantemos simples
        created++;
      }
    }

    await audit(request, "catalog.imported", "products", undefined);
    reply.send({ created, updated, errors });
  });

  // ---------------------------------------------------------------- Preço e estoque da variante
  app.patch("/api/admin/variants/:id", { preHandler: [A, adminGuard("products","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      priceCents?: number;
      promoPriceCents?: number | null;
      weightGrams?: number;
      active?: boolean;
      stockPhysical?: number;
      stockMin?: number;
    };
    const [row] = await db
      .update(schema.productVariants)
      .set({
        ...(body.priceCents !== undefined ? { priceCents: body.priceCents } : {}),
        ...(body.promoPriceCents !== undefined ? { promoPriceCents: body.promoPriceCents } : {}),
        ...(body.weightGrams !== undefined ? { weightGrams: body.weightGrams } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      })
      .where(eq(schema.productVariants.id, id))
      .returning();
    if (!row) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Variante não encontrada" } });
      return;
    }
    if (body.stockPhysical !== undefined || body.stockMin !== undefined) {
      const current = await db.select().from(schema.inventory).where(eq(schema.inventory.variantId, id)).limit(1);
      const physical = body.stockPhysical ?? current[0]?.physical ?? 0;
      const min = body.stockMin ?? current[0]?.minQuantity ?? 0;
      if (current[0]) {
        await db
          .update(schema.inventory)
          .set({ physical, minQuantity: min, updatedAt: new Date() })
          .where(eq(schema.inventory.variantId, id));
      } else {
        await db.insert(schema.inventory).values({ variantId: id, physical, reserved: 0, minQuantity: min });
      }
      await db.insert(schema.inventoryMovements).values({
        id: randomUUID(),
        variantId: id,
        type: "ajuste",
        quantity: Math.abs(physical - (current[0]?.physical ?? 0)),
        physicalBefore: current[0]?.physical ?? 0,
        physicalAfter: physical,
        reservedBefore: current[0]?.reserved ?? 0,
        reservedAfter: current[0]?.reserved ?? 0,
        reason: "Ajuste pelo painel",
        userId: actorOf(request),
      });
    }
    await audit(request, "variant.updated", "product_variants", id);
    reply.send({ variant: row });
  });

  app.get("/api/admin/inventory/movements", { preHandler: [A, adminGuard("inventory","read")] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 100) || 100));
    const rows = await db
      .select()
      .from(schema.inventoryMovements)
      .orderBy(desc(schema.inventoryMovements.createdAt))
      .limit(limit);
    reply.send({ items: rows });
  });

  // ---------------------------------------------------------------- Expedição e rastreio
  app.post("/api/admin/orders/:id/shipment", { preHandler: [A, adminGuard("orders","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      carrier?: string;
      trackingCode?: string;
      estimatedDays?: number;
      shippingCents?: number;
      status?: string;
      description?: string;
    };
    if (!body?.carrier) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "Transportadora é obrigatória" } });
      return;
    }
    const [shipment] = await db
      .insert(schema.shipments)
      .values({
        orderId: id,
        carrier: body.carrier,
        trackingCode: body.trackingCode ?? null,
        shippingCents: body.shippingCents ?? 0,
        estimatedDays: body.estimatedDays ?? null,
        shippedAt: new Date(),
      })
      .returning();
    await db.insert(schema.shippingEvents).values({
      shipmentId: shipment!.id,
      status: body.status ?? "enviado",
      description: body.description ?? "Objeto postado",
    });
    await audit(request, "shipment.created", "shipments", shipment?.id);
    reply.status(201);
    reply.send({ shipment });
  });

  app.get("/api/admin/orders/:id/shipment", { preHandler: [A, adminGuard("orders","read")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const shipments = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, id));
    const events = shipments.length
      ? await db
          .select()
          .from(schema.shippingEvents)
          .where(eq(schema.shippingEvents.shipmentId, shipments[0]!.id))
          .orderBy(asc(schema.shippingEvents.createdAt))
      : [];
    reply.send({ shipment: shipments[0] ?? null, events });
  });

  // ---------------------------------------------------------------- Atendimento
  app.get("/api/admin/tickets", { preHandler: [A, adminGuard("customers","read")] }, async (_request, reply) => {
    const rows = await db
      .select()
      .from(schema.supportTickets)
      .orderBy(desc(schema.supportTickets.createdAt))
      .limit(200);
    reply.send({ items: rows });
  });

  app.patch("/api/admin/tickets/:id", { preHandler: [A, adminGuard("customers","update")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string };
    const [row] = await db
      .update(schema.supportTickets)
      .set({ status: body.status ?? "aberto" })
      .where(eq(schema.supportTickets.id, id))
      .returning();
    if (!row) {
      reply.status(404);
      reply.send({ error: { code: "not_found", message: "Chamado não encontrado" } });
      return;
    }
    await audit(request, "ticket.updated", "support_tickets", id);
    reply.send({ ticket: row });
  });

  // ---------------------------------------------------------------- Configurações comerciais
  app.get("/api/admin/settings", { preHandler: [A, adminGuard("settings","read")] }, async (_request, reply) => {
    const rows = await db.select().from(schema.systemSettings);
    reply.send({
      items: rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updatedAt })),
    });
  });

  app.put("/api/admin/settings/:key", { preHandler: [A, adminGuard("settings","update")] }, async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as { value?: unknown };
    if (body?.value === undefined) {
      reply.status(400);
      reply.send({ error: { code: "invalid_input", message: "value é obrigatório" } });
      return;
    }
    const [row] = await db
      .insert(schema.systemSettings)
      .values({ key, value: body.value as Record<string, unknown> })
      .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: body.value as Record<string, unknown>, updatedAt: new Date() } })
      .returning();
    await audit(request, "settings.updated", "system_settings", key);
    reply.send({ setting: row });
  });

  // ---------------------------------------------------------------- Auditoria e relatórios
  app.get("/api/admin/audit", { preHandler: [A, adminGuard("audit","read")] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(300, Math.max(1, Number(q.limit ?? 100) || 100));
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    const result = await listAudit(db, {
      entity: q.entity?.trim() || undefined,
      entityId: q.entityId?.trim() || undefined,
      actorUserId: q.actorUserId?.trim() || undefined,
      actorLabel: q.actorLabel?.trim() || undefined,
      action: q.action?.trim() || undefined,
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
      cursor: q.cursor?.trim() || undefined,
      limit,
    });
    reply.send({
      items: result.items,
      total: result.total,
      limit: result.limit,
      nextCursor: result.nextCursor,
    });
  });

  app.get("/api/admin/reports", { preHandler: [A, adminGuard("reports","read")] }, async (_request, reply) => {
    const [sales, products, lowStock, tickets, chargebacks] = await Promise.all([
      db
        .select({
          day: schema.dailyMetrics.day,
          created: schema.dailyMetrics.ordersCreated,
          approved: schema.dailyMetrics.ordersApproved,
          gross: schema.dailyMetrics.grossCents,
          refunded: schema.dailyMetrics.refundedCents,
        })
        .from(schema.dailyMetrics)
        .orderBy(desc(schema.dailyMetrics.day))
        .limit(30),
      db.select({ count: sql`count(*)::int` }).from(schema.products).where(eq(schema.products.published, true)),
      db
        .select({
          variantId: schema.inventory.variantId,
          physical: schema.inventory.physical,
          reserved: schema.inventory.reserved,
          minQuantity: schema.inventory.minQuantity,
        })
        .from(schema.inventory)
        .where(sql`${schema.inventory.physical} - ${schema.inventory.reserved} <= ${schema.inventory.minQuantity}`),
      db.select({ count: sql`count(*)::int` }).from(schema.supportTickets).where(eq(schema.supportTickets.status, "aberto")),
      db.select({ count: sql`count(*)::int` }).from(schema.chargebacks),
    ]);

    const topVariants = await db.execute(sql`
      SELECT pv.sku AS sku, pv.name AS name, sum(oi.quantity)::int AS sold
      FROM order_items oi
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status NOT IN ('cancelado', 'reembolsado')
      GROUP BY pv.sku, pv.name
      ORDER BY sold DESC
      LIMIT 10
    `);

    reply.send({
      sales,
      publishedProducts: Number(products[0]?.count ?? 0),
      lowStock,
      openTickets: Number(tickets[0]?.count ?? 0),
      chargebacks: Number(chargebacks[0]?.count ?? 0),
      topProducts: (topVariants as { rows: unknown[] }).rows,
    });
  });
}
