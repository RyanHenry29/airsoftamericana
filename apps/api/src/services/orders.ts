import { eq, sql, and, gte, lt, count, sum, inArray } from "drizzle-orm";
import { canTransition, type OrderStatus, RESERVED_STATUSES } from "@airsoft/shared";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { releaseStock } from "./inventory.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Detalhe do pedido para o cliente (ESPIAR/COMPRAR).
 * Devolve o pedido + itens enriquecidos: cada item ganha productSlug e as
 * variantes ativas do produto (id + nome + preço) para o cliente escolher
 * a cor/tamanho antes de recomprar. Itens de produto removido do catálogo
 * ficam com productSlug null (o COMPRAR some, o ESPIAR continua útil).
 * Lança notFound se o pedido não existir ou não pertence ao cliente.
 */
export async function getOrderDetailForCustomer(
  db: Db,
  input: { orderId: string; customerId: string },
): Promise<{
  order: typeof schema.orders.$inferSelect;
  items: Array<{
    id: string;
    variantId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    productSlug: string | null;
    variants: Array<{ id: string; name: string; priceCents: number }>;
  }>;
}> {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, input.orderId), eq(schema.orders.customerId, input.customerId)))
    .limit(1);
  if (!order) throw notFound("Pedido não encontrado");

  const items = await db
    .select({
      id: schema.orderItems.id,
      variantId: schema.orderItems.variantId,
      sku: schema.orderItems.sku,
      name: schema.orderItems.name,
      quantity: schema.orderItems.quantity,
      unitPriceCents: schema.orderItems.unitPriceCents,
      totalCents: schema.orderItems.totalCents,
      productId: schema.products.id,
      productSlug: schema.products.slug,
    })
    .from(schema.orderItems)
    .leftJoin(schema.productVariants, eq(schema.productVariants.id, schema.orderItems.variantId))
    .leftJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(eq(schema.orderItems.orderId, order.id));

  // Variantes ativas dos produtos envolvidos — uma query para todos os itens.
  const productIds = [...new Set(items.map((i) => i.productId).filter((v): v is string => Boolean(v)))];
  const siblingRows = productIds.length
    ? await db
        .select({
          id: schema.productVariants.id,
          name: schema.productVariants.name,
          priceCents: schema.productVariants.priceCents,
          productId: schema.productVariants.productId,
        })
        .from(schema.productVariants)
        .where(and(inArray(schema.productVariants.productId, productIds), eq(schema.productVariants.active, true)))
    : [];
  const variantsByProduct = new Map<string, Array<{ id: string; name: string; priceCents: number }>>();
  for (const v of siblingRows) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push({ id: v.id, name: v.name, priceCents: v.priceCents });
    variantsByProduct.set(v.productId, list);
  }

  return {
    order,
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      totalCents: i.totalCents,
      productSlug: i.productSlug ?? null,
      variants: i.productId ? (variantsByProduct.get(i.productId) ?? []) : [],
    })),
  };
}

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  reason?: string;
  actorUserId?: string;
  actorLabel?: string;
  ip?: string;
}

/**
 * Núcleo da transição — roda DENTRO de uma transação do chamador. A leitura
 * do status e a validação acontecem com SELECT FOR UPDATE: dois concorrentes
 * (webhook duplo, admin + webhook, checkout + webhook) ficam serializados no
 * lock da linha e o segundo reavalia `canTransition` contra o estado já
 * atualizado. Auditoria de order.transition NÃO é gravada aqui — o chamador
 * decide (dentro ou fora da própria transação).
 */
export async function transitionOrderInTx(
  tx: Db,
  input: TransitionInput,
): Promise<{ transitioned: boolean; from: OrderStatus }> {
  const rows = await tx
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, input.orderId))
    .for("update");
  const order = rows[0];
  if (!order) throw notFound("Pedido não encontrado");

  const from = order.status as OrderStatus;
  if (from === input.to) return { transitioned: false, from };
  if (!canTransition(from, input.to as OrderStatus)) {
    throw conflict(
      "invalid_transition",
      `Transição inválida: ${from} → ${input.to}`,
      { from, to: input.to },
    );
  }

  await tx
    .update(schema.orders)
    .set({ status: input.to, updatedAt: new Date() })
    .where(eq(schema.orders.id, input.orderId));
  await tx.insert(schema.orderStatusHistory).values({
    id: crypto.randomUUID(),
    orderId: input.orderId,
    fromStatus: from,
    toStatus: input.to,
    reason: input.reason ?? null,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorUserId ? "user" : "system",
    actorSystem: !input.actorUserId,
    createdAt: new Date(),
  });

  if (
    (input.to === "cancelado" || input.to === "reembolsado") &&
    (RESERVED_STATUSES as readonly string[]).includes(from)
  ) {
    const items = await tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, input.orderId));
    for (const item of items) {
      await releaseStock(tx as unknown as Db, {
        variantId: item.variantId,
        quantity: item.quantity,
        orderId: input.orderId,
        reason: `Pedido ${input.to}`,
      });
    }
  }

  return { transitioned: true, from };
}

export async function transitionOrder(db: Db, input: TransitionInput): Promise<boolean> {
  // Transição standalone: abre a própria transação (mesma semântica do núcleo
  // acima) e grava a auditoria FORA dela — audit_logs não participa do lock.
  let outcome: { transitioned: boolean; from: OrderStatus } | undefined;
  await db.transaction(async (tx) => {
    outcome = await transitionOrderInTx(tx, input);
  });

  if (!outcome!.transitioned) return false; // idempotente: pedido já estava no status alvo

  await audit(db, {
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    action: "order.transition",
    entity: "order",
    entityId: input.orderId,
    before: { status: outcome!.from },
    after: { status: input.to, reason: input.reason },
    ip: input.ip,
  });

  return true;
}

export interface VolumeUsage {
  ordersToday: number;
  revenueTodayCents: number;
  limits: {
    maxOrdersPerDay: number;
    maxRevenuePerDayCents: number;
    maxOrdersPerCustomerPerDay: number;
    maxOrderValueCents: number;
    actionWhenExceeded: string;
    enabled: boolean;
  };
}

export async function getVolumeUsage(db: Db): Promise<VolumeUsage> {
  const limitRows = await db.select().from(schema.orderVolumeLimits);
  const limits = limitRows[0] ?? {
    maxOrdersPerDay: 0,
    maxRevenuePerDayCents: 0,
    maxOrdersPerCustomerPerDay: 0,
    maxOrderValueCents: 0,
    actionWhenExceeded: "bloquear_checkout",
    enabled: false,
  };

  const day = today();
  const [usage] = await db
    .select({
      orders: count(),
      revenue: sum(schema.orders.totalCents),
    })
    .from(schema.orders)
    .where(
      and(
        gte(schema.orders.createdAt, new Date(`${day}T00:00:00Z`)),
        lt(schema.orders.createdAt, new Date(`${day}T23:59:59.999Z`)),
        sql`${schema.orders.status} <> 'cancelado'`,
      ),
    );

  return {
    ordersToday: Number(usage?.orders ?? 0),
    revenueTodayCents: Number(usage?.revenue ?? 0),
    limits: {
      maxOrdersPerDay: Number(limits.maxOrdersPerDay),
      maxRevenuePerDayCents: Number(limits.maxRevenuePerDayCents),
      maxOrdersPerCustomerPerDay: Number(limits.maxOrdersPerCustomerPerDay),
      maxOrderValueCents: Number(limits.maxOrderValueCents),
      actionWhenExceeded: limits.actionWhenExceeded,
      enabled: Boolean(limits.enabled),
    },
  };
}

export async function checkOrderVolume(
  db: Db,
  input: { customerId: string; totalCents: number },
): Promise<{ allowed: boolean; requiresReview: boolean; reason?: string }> {
  const usage = await getVolumeUsage(db);
  const { limits } = usage;
  if (!limits.enabled) return { allowed: true, requiresReview: false };

  if (limits.maxOrderValueCents > 0 && input.totalCents > limits.maxOrderValueCents) {
    return decide(limits, `Valor do pedido acima do limite (R$ ${(limits.maxOrderValueCents / 100).toFixed(2)})`);
  }
  if (limits.maxOrdersPerDay > 0 && usage.ordersToday >= limits.maxOrdersPerDay) {
    return decide(limits, `Cota diária de pedidos atingida (${usage.ordersToday}/${limits.maxOrdersPerDay})`);
  }
  if (
    limits.maxRevenuePerDayCents > 0 &&
    usage.revenueTodayCents + input.totalCents > limits.maxRevenuePerDayCents
  ) {
    return decide(limits, "Cota diária de faturamento seria ultrapassada");
  }
  if (limits.maxOrdersPerCustomerPerDay > 0) {
    const day = today();
    const [customerToday] = await db
      .select({ n: count() })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerId, input.customerId),
          gte(schema.orders.createdAt, new Date(`${day}T00:00:00Z`)),
          lt(schema.orders.createdAt, new Date(`${day}T23:59:59.999Z`)),
        ),
      );
    if (Number(customerToday?.n ?? 0) >= limits.maxOrdersPerCustomerPerDay) {
      return decide(
        limits,
        `Limite de pedidos por cliente no dia (${customerToday?.n}/${limits.maxOrdersPerCustomerPerDay})`,
      );
    }
  }
  return { allowed: true, requiresReview: false };
}

function decide(
  limits: VolumeUsage["limits"],
  reason: string,
): { allowed: boolean; requiresReview: boolean; reason: string } {
  if (limits.actionWhenExceeded === "revisao_manual") {
    return { allowed: true, requiresReview: true, reason };
  }
  return { allowed: false, requiresReview: false, reason };
}

export async function nextOrderNumber(db: Db): Promise<string> {
  const day = today();
  const [row] = await db
    .select({ n: count() })
    .from(schema.orders)
    .where(eq(schema.orders.volumeDay, day));
  const seq = String(Number(row?.n ?? 0) + 1).padStart(6, "0");
  return `AA-${day.replace(/-/g, "").slice(2)}-${seq}`;
}