import { and, count, eq, gte, lte, sql, sum } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export async function getMetrics(db: Db, from?: Date, to?: Date) {
  const conditions = [];
  if (from) conditions.push(gte(schema.orders.createdAt, from));
  if (to) conditions.push(lte(schema.orders.createdAt, to));
  const where = conditions.length ? and(...conditions) : undefined;

  const [faturamento] = await db
    .select({ total: sum(schema.orders.totalCents), n: count() })
    .from(schema.orders)
    .where(and(sql`${schema.orders.status} NOT IN ('cancelado','reembolsado','chargeback_recebido')`, where));

  const byStatus = await db
    .select({ status: schema.orders.status, n: count(), revenue: sum(schema.orders.totalCents) })
    .from(schema.orders)
    .where(where)
    .groupBy(schema.orders.status);

  const [ticket] = await db
    .select({ avg: sql<number>`COALESCE(AVG(${schema.orders.totalCents}), 0)` })
    .from(schema.orders)
    .where(and(sql`${schema.orders.status} NOT IN ('cancelado')`, where));

  const [chargebacks] = (await (() => {
    const base = db.select({ n: count(), amount: sql`COALESCE(sum(${schema.chargebacks.amountCents}), 0)` }).from(schema.chargebacks);
    return from || to
      ? base.where(and(from ? gte(schema.chargebacks.notifiedAt, from) : undefined, to ? lte(schema.chargebacks.notifiedAt, to) : undefined))
      : base;
  })()) as { n: number; amount: number }[];

  const lowStock = await db
    .select({
      variantId: schema.inventory.variantId,
      physical: schema.inventory.physical,
      reserved: schema.inventory.reserved,
      minQuantity: schema.inventory.minQuantity,
      sku: schema.productVariants.sku,
      name: schema.productVariants.name,
      productName: schema.products.name,
    })
    .from(schema.inventory)
    .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.inventory.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(sql`${schema.inventory.physical} <= ${schema.inventory.minQuantity}`)
    .limit(50);

  const recusados = await db.select({ n: count() }).from(schema.payments).where(eq(schema.payments.status, "recusado"));
  const emAnalise = await db.select({ n: count() }).from(schema.orders).where(eq(schema.orders.status, "em_analise_antifraude"));

  const grossCents = Number(faturamento?.total ?? 0);
  const ordersCount = Number(faturamento?.n ?? 0);
  const ticketMedio = Number(ticket?.avg ?? 0);
  const recusadosCount = Number(recusados[0]?.n ?? 0);
  const approvalRate = ordersCount > 0 ? Math.max(0, 100 - (recusadosCount / Math.max(ordersCount, 1)) * 100) : 100;

  return {
    faturamentoDia: grossCents,
    pedidosRecebidos: ordersCount,
    ticketMedioCents: Math.round(ticketMedio),
    taxaAprovacao: Number(approvalRate.toFixed(2)),
    chargebacks: { total: Number(chargebacks?.n ?? 0), valorCents: Number(chargebacks?.amount ?? 0) },
    pagamentosRecusados: recusadosCount,
    emAnalise: Number(emAnalise[0]?.n ?? 0),
    porStatus: byStatus.map((r) => ({ status: r.status, total: Number(r.n), revenueCents: Number(r.revenue ?? 0) })),
    estoqueBaixo: lowStock.map((r) => ({
      variantId: r.variantId,
      sku: r.sku,
      productName: r.productName,
      name: r.name,
      physical: r.physical,
      reserved: r.reserved,
      minQuantity: r.minQuantity,
    })),
  };
}

export async function getTopProducts(db: Db, limit = 10) {
  const rows = await db
    .select({
      productId: schema.orderItems.variantId,
      sku: schema.orderItems.sku,
      name: schema.orderItems.name,
      qty: sql<number>`SUM(${schema.orderItems.quantity})`,
      revenue: sql<number>`SUM(${schema.orderItems.totalCents})`,
    })
    .from(schema.orderItems)
    .groupBy(schema.orderItems.variantId, schema.orderItems.sku, schema.orderItems.name)
    .orderBy(sql`SUM(${schema.orderItems.quantity}) DESC`)
    .limit(limit);
  return rows.map((r) => ({ id: r.productId, sku: r.sku, name: r.name, qty: Number(r.qty), revenueCents: Number(r.revenue) }));
}