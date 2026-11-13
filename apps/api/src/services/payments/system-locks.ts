// language: TS, file: apps/api/src/services/payments/system-locks.ts, target: Fastify 5 + drizzle (PGlite | node-postgres)
/**
 * Locks de sistema (revisão v5, item 3): exclusão de manutenção ENTRE
 * INSTÂNCIAS, garantida no banco — `setInterval` + flag local só protege
 * um processo; duas instâncias em produção executariam a mesma varredura
 * em paralelo.
 *
 * Tabela `system_locks`: PK `name`, token do dono, expiração.
 *  - AQUISIÇÃO ATÔMICA: `INSERT ... ON CONFLICT (name) DO UPDATE ... WHERE
 *    expirado RETURNING` — duas instâncias correndo simultaneamente: no
 *    máximo uma recebe token; a outra recebe NULL e pula a passada.
 *  - RENOVAÇÃO: somente pelo dono atual (guarda por token) — passada longa
 *    não perde o lock no meio.
 *  - EXPIRAÇÃO: sozinha, pelo relógio do banco — crash da instância
 *    devolve o lock sem intervenção.
 */
import { sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { randomUUID } from "node:crypto";

interface RawResult<T> {
  rows: T[];
}

/**
 * Tenta adquirir o lock `name` por `ttlMs`. Atômico: em corrida, no máximo
 * um chamador recebe token. Devolve o token do dono, ou `null` se outra
 * instância válida já o detém.
 */
export async function acquireSystemLock(db: Db, name: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const res: any = await db.execute(sql`
    INSERT INTO "system_locks" ("name", "lease_token", "lease_expires_at", "updated_at")
    VALUES (${name}, ${token}, now() + ${ttlMs}::bigint * interval '1 millisecond', now())
    ON CONFLICT ("name") DO UPDATE
      SET "lease_token" = EXCLUDED."lease_token",
          "lease_expires_at" = EXCLUDED."lease_expires_at",
          "updated_at" = now()
      WHERE "system_locks"."lease_expires_at" IS NULL
         OR "system_locks"."lease_expires_at" <= now()
    RETURNING "lease_token"
  `);
  const rows = (res as unknown as RawResult<{ lease_token: string }>).rows ?? [];
  return rows.length > 0 && rows[0]?.lease_token === token ? token : null;
}

/**
 * Renova o lease — SOMENTE pelo dono (token). Devolve false se o lock
 * expirou e foi tomado por outra instância: o dono não é mais dono.
 */
export async function renewSystemLock(db: Db, name: string, token: string, ttlMs: number): Promise<boolean> {
  const res: any = await db.execute(sql`
    UPDATE "system_locks"
    SET "lease_expires_at" = now() + ${ttlMs}::bigint * interval '1 millisecond',
        "updated_at" = now()
    WHERE "name" = ${name} AND "lease_token" = ${token}
    RETURNING "name"
  `);
  const rows = (res as unknown as RawResult<{ name: string }>).rows ?? [];
  return rows.length > 0;
}

/** Libera o lock — somente pelo dono. Idempotente (token errado = no-op). */
export async function releaseSystemLock(db: Db, name: string, token: string): Promise<boolean> {
  const res: any = await db.execute(sql`
    UPDATE "system_locks"
    SET "lease_token" = NULL, "lease_expires_at" = NULL, "updated_at" = now()
    WHERE "name" = ${name} AND "lease_token" = ${token}
    RETURNING "name"
  `);
  const rows = (res as unknown as RawResult<{ name: string }>).rows ?? [];
  return rows.length > 0;
}

/**
 * Executa `fn` sob o lock `name`:
 *  - adquirido → roda `fn` com RENOVAÇÃO em heartbeat (a cada ttl/3, o
 *    lease é estendido — passada longa não perde o lock no meio);
 *  - não adquirido → devolve { ok: false } SEM rodar `fn` (outra instância
 *    é a responsável por esta passada);
 *  - RENOVAÇÃO RECUSADA (token não é mais o dono) → `ctx.lost()` passa a
 *    devolver true: `fn` ABORTA COOPERATIVAMENTE entre fases — um worker
 *    não continua manutenção depois de perder o lock. Falha TRANSITÓRIA
 *    de rede na renovação NÃO marca perda (o token ainda é nosso; próximo
 *    heartbeat renova);
 *  - qualquer falha → lock liberado no `finally` (release é idempotente
 *    por token; se o lease já expirou, expira sozinho).
 */
export async function withSystemLock<T>(
  db: Db,
  name: string,
  ttlMs: number,
  fn: (ctx: { /** true = a renovação confirmou que o lock foi tomado por outro. */ lost: () => boolean }) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const token = await acquireSystemLock(db, name, ttlMs);
  if (!token) return { ok: false };

  let ownerLost = false;
  // Heartbeat de renovação: ttl/3, unref. Recusa na renovação = o lock foi
  // tomado por outra instância (guarda por token): marca a perda — `fn`
  // decide onde abortar. Erro na renovação = transitório: não marca.
  const heartbeat = setInterval(() => {
    void renewSystemLock(db, name, token, ttlMs)
      .then((renewed) => {
        if (!renewed) ownerLost = true;
      })
      .catch(() => {});
  }, Math.max(1_000, Math.floor(ttlMs / 3)));
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  try {
    return { ok: true, value: await fn({ lost: () => ownerLost }) };
  } finally {
    clearInterval(heartbeat);
    await releaseSystemLock(db, name, token).catch(() => {});
  }
}
