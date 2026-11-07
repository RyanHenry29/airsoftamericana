// language: TS, file: apps/api/src/services/product-history.ts, target: Node (Fastify/Drizzle)
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export type HistoryEntry = {
  productId: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  field: string;
  beforeValue: unknown;
  afterValue: unknown;
};

export async function appendProductHistory(db: Db, entries: HistoryEntry[]) {
  if (!entries.length) return;
  const rows = entries
    .filter((e) => JSON.stringify(e.beforeValue ?? null) !== JSON.stringify(e.afterValue ?? null))
    .map((e) => ({
      productId: e.productId,
      actorUserId: e.actorUserId ?? null,
      actorLabel: e.actorLabel ?? null,
      field: e.field.slice(0, 80),
      beforeValue: e.beforeValue == null ? null : String(typeof e.beforeValue === "string" ? e.beforeValue : JSON.stringify(e.beforeValue)).slice(0, 4000),
      afterValue: e.afterValue == null ? null : String(typeof e.afterValue === "string" ? e.afterValue : JSON.stringify(e.afterValue)).slice(0, 4000),
    }));
  if (!rows.length) return;
  await db.insert(schema.productChangeHistory).values(rows as any);
}

export function canSeeCost(role: string | null | undefined): boolean {
  return role === "superadmin" || role === "gerente" || role === "financeiro";
}
