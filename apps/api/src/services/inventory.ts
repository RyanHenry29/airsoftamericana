import { eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { InventoryMovementType } from "@airsoft/shared";

interface Snapshot {
  physical: number;
  reserved: number;
}

async function lockInventory(
  db: Db,
  variantId: string,
): Promise<{ id: string } & Snapshot> {
  const rows = await db
    .select()
    .from(schema.inventory)
    .where(eq(schema.inventory.variantId, variantId))
    .for("update");
  const row = rows[0];
  if (!row) throw notFound("Item de estoque não encontrado");
  return row;
}

async function writeMovement(
  db: Db,
  input: {
    variantId: string;
    type: InventoryMovementType;
    quantity: number;
    before: Snapshot;
    after: Snapshot;
    reason: string;
    orderId?: string | null;
    userId?: string | null;
  },
): Promise<void> {
  await db.insert(schema.inventoryMovements).values({
    id: crypto.randomUUID(),
    variantId: input.variantId,
    type: input.type,
    quantity: input.quantity,
    physicalBefore: input.before.physical,
    physicalAfter: input.after.physical,
    reservedBefore: input.before.reserved,
    reservedAfter: input.after.reserved,
    reason: input.reason,
    orderId: input.orderId ?? null,
    userId: input.userId ?? null,
    createdAt: new Date(),
  });
}

/**
 * Reserva unidades para um pedido. Transacional e idempotente por
 * (pedido, variante): repetir a chamada não reserva duas vezes.
 * Falha com 409 se disponível < quantidade.
 */
export async function reserveStock(
  db: Db,
  input: {
    variantId: string;
    quantity: number;
    orderId: string;
    reason?: string;
  },
): Promise<void> {
  if (input.quantity <= 0) throw badRequest("invalid_quantity", "Quantidade deve ser > 0");

  const existing = await db
    .select()
    .from(schema.inventoryMovements)
    .where(sql`
      ${schema.inventoryMovements.variantId} = ${input.variantId}
      AND ${schema.inventoryMovements.orderId} = ${input.orderId}
      AND ${schema.inventoryMovements.type} = 'reserva'
    `);
  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
    const inv = await lockInventory(tx as unknown as Db, input.variantId);
    const available = inv.physical - inv.reserved;
    if (available < input.quantity) {
      throw conflict(
        "insufficient_stock",
        `Estoque insuficiente: disponível ${available}, pedido ${input.quantity}`,
        { available, requested: input.quantity, variantId: input.variantId },
      );
    }
    const before = { physical: inv.physical, reserved: inv.reserved };
    const after = { physical: inv.physical, reserved: inv.reserved + input.quantity };
    await tx
      .update(schema.inventory)
      .set({ reserved: after.reserved, updatedAt: new Date() })
      .where(eq(schema.inventory.id, inv.id));
    await writeMovement(tx as unknown as Db, {
      variantId: input.variantId,
      type: "reserva",
      quantity: input.quantity,
      before,
      after,
      reason: input.reason ?? "Reserva de pedido",
      orderId: input.orderId,
    });
  });
}

/** Libera a reserva (cancelamento/expiração) — devolve ao disponível. */
export async function releaseStock(
  db: Db,
  input: { variantId: string; quantity: number; orderId: string; reason?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const inv = await lockInventory(tx as unknown as Db, input.variantId);
    if (inv.reserved <= 0) return;
    const release = Math.min(inv.reserved, input.quantity);
    const before = { physical: inv.physical, reserved: inv.reserved };
    const after = { physical: inv.physical, reserved: inv.reserved - release };
    await tx
      .update(schema.inventory)
      .set({ reserved: after.reserved, updatedAt: new Date() })
      .where(eq(schema.inventory.id, inv.id));
    await writeMovement(tx as unknown as Db, {
      variantId: input.variantId,
      type: "liberacao",
      quantity: release,
      before,
      after,
      reason: input.reason ?? "Liberação de reserva",
      orderId: input.orderId,
    });
  });
}

/** Baixa física definitiva (após separação/envio) — sai do físico E do reservado. */
export async function consumeStock(
  db: Db,
  input: { variantId: string; quantity: number; orderId: string; reason?: string; userId?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const inv = await lockInventory(tx as unknown as Db, input.variantId);
    if (inv.physical < input.quantity) {
      throw conflict("insufficient_stock", "Estoque físico insuficiente para baixa");
    }
    const before = { physical: inv.physical, reserved: inv.reserved };
    const after = {
      physical: inv.physical - input.quantity,
      reserved: Math.max(0, inv.reserved - input.quantity),
    };
    await tx
      .update(schema.inventory)
      .set({ physical: after.physical, reserved: after.reserved, updatedAt: new Date() })
      .where(eq(schema.inventory.id, inv.id));
    await writeMovement(tx as unknown as Db, {
      variantId: input.variantId,
      type: "saida",
      quantity: input.quantity,
      before,
      after,
      reason: input.reason ?? "Baixa por pedido",
      orderId: input.orderId,
      userId: input.userId,
    });
  });
}

/** Entrada/ajuste manual pelo admin — sempre com motivo e autor. */
export async function adjustStock(
  db: Db,
  input: {
    variantId: string;
    type: Extract<InventoryMovementType, "entrada" | "saida" | "ajuste" | "transferencia">;
    quantity: number;
    reason: string;
    userId?: string | null;
  },
): Promise<Snapshot> {
  let result: Snapshot | undefined;
  await db.transaction(async (tx) => {
    result = await adjustStockInTx(tx, input);
  });
  if (!result) throw badRequest("adjust_failed", "Falha ao ajustar estoque");
  return result;
}

/**
 * Core de ajuste de estoque executado dentro de uma transação já aberta
 * (passada via `tx`). Usado por adjustStock (que abre sua própria tx) e por
 * rotas que precisam de auditoria na mesma transação do movimento.
 */
export async function adjustStockInTx(
  tx: any,
  input: {
    variantId: string;
    type: Extract<InventoryMovementType, "entrada" | "saida" | "ajuste" | "transferencia">;
    quantity: number;
    reason: string;
    userId?: string | null;
  },
): Promise<Snapshot> {
  if (input.quantity <= 0) throw badRequest("invalid_quantity", "Quantidade deve ser > 0");
  if (input.reason.trim().length < 3) {
    throw badRequest("reason_required", "Informe o motivo da movimentação");
  }

  const inv = await lockInventory(tx, input.variantId);
  const before = { physical: inv.physical, reserved: inv.reserved };
  let physical = inv.physical;
  if (input.type === "entrada" || input.type === "transferencia") {
    physical += input.quantity;
  } else if (input.type === "saida") {
    physical -= input.quantity;
  } else {
    physical = input.quantity;
  }
  if (physical < 0) {
    throw conflict("negative_stock", "A movimentação deixaria o estoque negativo");
  }
  if (physical < inv.reserved) {
    throw conflict(
      "below_reserved",
      `Estoque físico ficaria abaixo do reservado (${inv.reserved})`,
    );
  }
  const after = { physical, reserved: inv.reserved };
  await tx
    .update(schema.inventory)
    .set({ physical: after.physical, updatedAt: new Date() })
    .where(eq(schema.inventory.id, inv.id));
  await writeMovement(tx as unknown as Db, {
    variantId: input.variantId,
    type: input.type,
    quantity: input.type === "ajuste" ? Math.abs(physical - before.physical) : input.quantity,
    before,
    after,
    reason: input.reason,
    userId: input.userId,
  });
  return after;
}

export async function getAvailable(db: Db, variantId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.inventory)
    .where(eq(schema.inventory.variantId, variantId));
  const row = rows[0];
  if (!row) return 0;
  return row.physical - row.reserved;
}