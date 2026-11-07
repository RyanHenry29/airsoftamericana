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

  it("E2E isolado (NODE_ENV=test + E2E_READY=1): omite chave IP (anti-cascata), preserva conta", () => {
    const prevN = process.env.NODE_ENV;
    const prevE = process.env.E2E_READY;
    try {
      process.env.NODE_ENV = "test";
      process.env.E2E_READY = "1";
      const keys = lockoutKeys("a@e2e.local", "1.2.3.4");
      expect(keys).toEqual(["acct:a@e2e.local"]);
    } finally {
      if (prevN === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevN;
      if (prevE === undefined) delete process.env.E2E_READY; else process.env.E2E_READY = prevE;
    }
  });

  it("NODE_ENV=test sem E2E_READY: lockout normal inclui IP", () => {
    const prevN = process.env.NODE_ENV;
    const prevE = process.env.E2E_READY;
    try {
      process.env.NODE_ENV = "test";
      delete process.env.E2E_READY;
      const keys = lockoutKeys("b@t.local", "1.2.3.4");
      expect(keys).toEqual(["acct:b@t.local", "ip:1.2.3.4"]);
    } finally {
      if (prevN === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevN;
      if (prevE === undefined) delete process.env.E2E_READY; else process.env.E2E_READY = prevE;
    }
  });

  it("NODE_ENV=production + E2E_READY=1: lockout normal, sem exceção/bypass", () => {
    const prevN = process.env.NODE_ENV;
    const prevE = process.env.E2E_READY;
    try {
      process.env.NODE_ENV = "production";
      process.env.E2E_READY = "1";
      const keys = lockoutKeys("c@prod.local", "1.2.3.4");
      expect(keys).toEqual(["acct:c@prod.local", "ip:1.2.3.4"]);
    } finally {
      if (prevN === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevN;
      if (prevE === undefined) delete process.env.E2E_READY; else process.env.E2E_READY = prevE;
    }
  });
});
