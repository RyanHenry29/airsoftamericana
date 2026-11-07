// language: TS, file: apps/api/src/services/lockout.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { isLocked, registerFailure, registerSuccess, lockoutKeys, __test } from "./lockout.js";

let db: any;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

describe("B.4 — bloqueio progressivo", () => {
  it("delay cresce 1,2,4,8 min e teto 1h", () => {
    expect(__test.delayFor(1)).toBe(1 * 60_000);
    expect(__test.delayFor(2)).toBe(2 * 60_000);
    expect(__test.delayFor(3)).toBe(4 * 60_000);
    expect(__test.delayFor(4)).toBe(8 * 60_000);
    expect(__test.delayFor(10)).toBe(__test.CAP);
  });

  it("bloqueia após falhas e zera no sucesso", async () => {
    const email = `lock-${Date.now()}@t.local`;
    const keys = lockoutKeys(email, "1.2.3.4");
    expect(await isLocked(db, keys)).toBe(false);
    await registerFailure(db, keys);
    // após 1 falha locked_until é ~1min no futuro
    const row = (await db.select().from(schema.authLockouts).where(eq(schema.authLockouts.key, keys[0]!)))[0];
    expect(row.failCount).toBe(1);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await isLocked(db, keys)).toBe(true);
    // sucesso zera
    await registerSuccess(db, keys);
    expect(await isLocked(db, keys)).toBe(false);
    const row2 = (await db.select().from(schema.authLockouts).where(eq(schema.authLockouts.key, keys[0]!)))[0];
    expect(row2.failCount).toBe(0);
    expect(row2.lockedUntil).toBeNull();
  });

  it("bloqueio por IP independente funciona", async () => {
    const keys = lockoutKeys(`other-${Date.now()}@t.local`, "9.9.9.9");
    await registerFailure(db, keys);
    // chave IP também bloqueia
    expect(await isLocked(db, [keys[1]!])).toBe(true);
  });
});
