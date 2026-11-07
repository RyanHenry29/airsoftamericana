// language: TS, file: apps/api/src/lib/audit.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { listAudit, decodeCursor, assertAuditLogsAppendOnly, checkAuditLogsPrivileges } from "./audit.js";

let db: any;
const ENTITY = `test-audit-b10-${Date.now()}`;
const base = new Date("2026-01-01T12:00:00.000Z");

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  // insere 5 registros controlados (append-only)
  const u1 = crypto.randomUUID();
  const u2 = crypto.randomUUID();
  const rows = [
    { id: crypto.randomUUID(), action: "x.one", entity: ENTITY, actorUserId: u1, actorLabel: "a@t.com", createdAt: new Date(base.getTime() + 1000) },
    { id: crypto.randomUUID(), action: "x.two", entity: ENTITY, actorUserId: u1, actorLabel: "a@t.com", createdAt: new Date(base.getTime() + 2000) },
    { id: crypto.randomUUID(), action: "x.three", entity: ENTITY, actorUserId: u2, actorLabel: "b@t.com", createdAt: new Date(base.getTime() + 3000) },
    { id: crypto.randomUUID(), action: "y.other", entity: ENTITY, actorUserId: u2, actorLabel: "b@t.com", createdAt: new Date(base.getTime() + 4000) },
    { id: crypto.randomUUID(), action: "x.five", entity: ENTITY, actorUserId: u1, actorLabel: "a@t.com", createdAt: new Date(base.getTime() + 5000) },
  ];
  for (const r of rows) await db.insert(schema.auditLogs).values(r);
  (globalThis as any).__B10_U1 = u1;
  (globalThis as any).__B10_U2 = u2;
});

describe("B.10 — listAudit (banco povoado)", () => {
  it("ordem decrescente (mais recente primeiro) e contagem no filtro", async () => {
    const res = await listAudit(db, { entity: ENTITY, limit: 10 });
    expect(res.total).toBe(5);
    expect(res.items).toHaveLength(5);
    const times = res.items.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(res.items[0]!.action).toBe("x.five");
  });

  it("filtros (action prefix, actorUserId) respeitados com contagem correta", async () => {
    const u2 = (globalThis as any).__B10_U2 as string;
    const byAction = await listAudit(db, { entity: ENTITY, action: "x.", limit: 10 });
    expect(byAction.total).toBe(4);
    expect(byAction.items.every((r) => r.action.startsWith("x."))).toBe(true);

    const byActor = await listAudit(db, { entity: ENTITY, actorUserId: u2, limit: 10 });
    expect(byActor.total).toBe(2);
    expect(byActor.items.every((r) => r.actorUserId === u2)).toBe(true);
  });

  it("cursor estável pagina sem pular/duplicar", async () => {
    const p1 = await listAudit(db, { entity: ENTITY, limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.nextCursor).toBeTruthy();
    const decoded = decodeCursor(p1.nextCursor!);
    expect(decoded).not.toBeNull();

    const p2 = await listAudit(db, { entity: ENTITY, limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(2);
    const p3 = await listAudit(db, { entity: ENTITY, limit: 2, cursor: p2.nextCursor! });
    expect(p3.items).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();

    const allIds = [...p1.items, ...p2.items, ...p3.items].map((r) => r.id);
    expect(new Set(allIds).size).toBe(5); // sem duplicata
    // mantém ordem global desc
    const times = [...p1.items, ...p2.items, ...p3.items].map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe("item 8 — audit_logs append-only: recusa subir em produção se DB user pode mutar", () => {
  it("fora de produção não verifica/não recusa", async () => {
    await expect(assertAuditLogsAppendOnly(db, "development")).resolves.toBeUndefined();
    await expect(assertAuditLogsAppendOnly(db, "test")).resolves.toBeUndefined();
  });

  it("em produção RECUSA se o usuário tem UPDATE ou DELETE (simulado)", async () => {
    const privileged = async () => ({ canUpdate: true, canDelete: false });
    await expect(assertAuditLogsAppendOnly(db, "production", privileged)).rejects.toThrow(/audit_logs/);
    const privilegedDel = async () => ({ canUpdate: false, canDelete: true });
    await expect(assertAuditLogsAppendOnly(db, "production", privilegedDel)).rejects.toThrow(/Refusing to start/);
  });

  it("em produção NÃO recusa com usuário sem privilégios de UPDATE/DELETE", async () => {
    const unpriv = async () => ({ canUpdate: false, canDelete: false });
    await expect(assertAuditLogsAppendOnly(db, "production", unpriv)).resolves.toBeUndefined();
  });

  it("checkAuditLogsPrivileges retorna shape válido (PGlite/best-effort)", async () => {
    const p = await checkAuditLogsPrivileges(db);
    expect(typeof p.canUpdate).toBe("boolean");
    expect(typeof p.canDelete).toBe("boolean");
  });
});
