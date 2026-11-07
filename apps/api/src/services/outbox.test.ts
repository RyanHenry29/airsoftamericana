// language: TS, file: apps/api/src/services/outbox.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { outboxNotify, loginNewDeviceBody, roleChangedBody, bulkPriceBody } from "./outbox.js";

let db: any;
beforeAll(async () => { db = await getDb(); await migrate(db); });

describe("B.7 — outbox notifications", () => {
  it("grava alerta de login em dispositivo novo", async () => {
    await (db as any).transaction(async (tx: any) => {
      await outboxNotify(tx, loginNewDeviceBody({ email: "a@b.com", ip: "1.2.3.4", userAgent: "UA" }));
    });
    const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.kind, "security.login_new_device"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("grava alerta de mudança de papel e alteração de preço em massa", async () => {
    await (db as any).transaction(async (tx: any) => {
      await outboxNotify(tx, roleChangedBody({ targetEmail: "t@t.com", from: "atendimento", to: "gerente", by: "admin" }));
      await outboxNotify(tx, bulkPriceBody({ count: 12, by: "admin", mode: "10%" }));
    });
    const r1 = await db.select().from(schema.notifications).where(eq(schema.notifications.kind, "security.role_changed"));
    const r2 = await db.select().from(schema.notifications).where(eq(schema.notifications.kind, "catalog.bulk_price_change"));
    expect(r1.length).toBeGreaterThan(0);
    expect(r2.length).toBeGreaterThan(0);
  });
});
