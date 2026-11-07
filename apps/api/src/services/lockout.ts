// language: TS, file: apps/api/src/services/lockout.ts, target: Fastify 5
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";

const MINUTE = 60 * 1000;
const DELAYS = [1 * MINUTE, 2 * MINUTE, 4 * MINUTE, 8 * MINUTE];
const CAP = 60 * MINUTE;

function delayFor(failCount: number): number {
  if (failCount <= 0) return 0;
  const idx = Math.min(failCount - 1, DELAYS.length - 1);
  const base = DELAYS[idx] ?? CAP;
  // após esgotar a tabela, dobra até o teto
  let d = base;
  for (let i = DELAYS.length; i < failCount; i++) d = Math.min(d * 2, CAP);
  return Math.min(d, CAP);
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function getRow(db: Db, key: string) {
  const rows = await db.select().from(schema.authLockouts).where(eq(schema.authLockouts.key, key)).limit(1);
  return rows[0] ?? null;
}

export function lockoutKeys(email: string, ip: string | undefined): string[] {
  const keys = [`acct:${normEmail(email)}`];
  // E2E isolado (NODE_ENV=test + E2E_READY=1, DB efêmero): omite chave por IP para
  // evitar cascata entre usuários distintos no mesmo host — preserva lockout por conta.
  // Nunca ativo em produção nem em testes unitários comuns (sem E2E_READY).
  const e2e = process.env.NODE_ENV === "test" && process.env.E2E_READY === "1";
  if (ip && !e2e) keys.push(`ip:${ip}`);
  return keys;
}

export async function isLocked(db: Db, keys: string[], now = new Date()): Promise<boolean> {
  for (const key of keys) {
    const row = await getRow(db, key);
    if (row?.lockedUntil && row.lockedUntil > now) return true;
  }
  return false;
}

export async function registerFailure(db: Db, keys: string[], now = new Date()): Promise<void> {
  for (const key of keys) {
    const row = await getRow(db, key);
    const nextCount = (row?.failCount ?? 0) + 1;
    const wait = delayFor(nextCount);
    const lockedUntil = wait > 0 ? new Date(now.getTime() + wait) : null;
    if (row) {
      await db.update(schema.authLockouts).set({ failCount: nextCount, lockedUntil, updatedAt: now }).where(eq(schema.authLockouts.key, key));
    } else {
      await db.insert(schema.authLockouts).values({ key, failCount: nextCount, lockedUntil, updatedAt: now }).onConflictDoNothing();
      // se conflito (corrida), atualiza
      const again = await getRow(db, key);
      if (again && again.failCount < nextCount) {
        await db.update(schema.authLockouts).set({ failCount: nextCount, lockedUntil, updatedAt: now }).where(eq(schema.authLockouts.key, key));
      }
    }
  }
}

export async function registerSuccess(db: Db, keys: string[]): Promise<void> {
  const now = new Date();
  for (const key of keys) {
    await db
      .insert(schema.authLockouts)
      .values({ key, failCount: 0, lockedUntil: null, updatedAt: now })
      .onConflictDoUpdate({ target: schema.authLockouts.key, set: { failCount: 0, lockedUntil: null, updatedAt: now } });
  }
}

// exportado para testes
export const __test = { delayFor, DELAYS, CAP };
