import { eq, and, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

export interface CouponValidation {
  valid: boolean;
  discountCents: number;
  kind?: string;
  message?: string;
  couponId?: string;
}

export async function validateCoupon(
  db: Db,
  input: { code: string; subtotalCents: number },
): Promise<CouponValidation> {
  const code = input.code.trim().toUpperCase();
  const rows = await db.select().from(schema.coupons).where(eq(schema.coupons.code, code));
  const coupon = rows[0];
  if (!coupon) return { valid: false, discountCents: 0, message: "Cupom inválido" };
  if (!coupon.active) return { valid: false, discountCents: 0, message: "Cupom inativo" };
  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) return { valid: false, discountCents: 0, message: "Cupom ainda não válido" };
  if (coupon.endsAt && now > coupon.endsAt) return { valid: false, discountCents: 0, message: "Cupom expirado" };
  if (coupon.minOrderCents > input.subtotalCents) {
    return { valid: false, discountCents: 0, message: `Pedido mínimo de R$ ${(coupon.minOrderCents / 100).toFixed(2)}` };
  }
  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    return { valid: false, discountCents: 0, message: "Cupom esgotado" };
  }

  let discountCents = 0;
  if (coupon.kind === "percentual") {
    discountCents = Math.floor((input.subtotalCents * coupon.value) / 100);
  } else if (coupon.kind === "fixo") {
    discountCents = Math.min(coupon.value, input.subtotalCents);
  } else if (coupon.kind === "frete") {
    // desconto aplicado ao frete no checkout — aqui retorna 0 no subtotal
    discountCents = 0;
  }

  return { valid: true, discountCents, kind: coupon.kind, couponId: coupon.id };
}

export async function incrementCouponUsage(db: Db, couponId: string): Promise<void> {
  await db
    .update(schema.coupons)
    .set({ usedCount: sql`${schema.coupons.usedCount} + 1` })
    .where(eq(schema.coupons.id, couponId));
}
