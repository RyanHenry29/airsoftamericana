// language: TS, file: apps/api/src/services/invites.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { createInvite, acceptInvite } from "./invites.js";

let db: any;
let superId: string;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  const email = `super-${Date.now()}@test.local`;
  const [u] = await db.insert(schema.users).values({
    email, passwordHash: await hashPassword("Senha123!"), name: "Super", role: "superadmin", active: true, mfaEnabled: true,
  }).returning();
  superId = u.id;
});

describe("B.3 — convites", () => {
  it("cria convite com hash (token cru só no retorno), expira em 48h", async () => {
    const inv = await createInvite(db, { email: `a-${Date.now()}@t.local`, role: "estoque", createdBy: superId });
    expect(inv.token).toBeTruthy();
    expect(inv.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1000);
    const [row] = await db.select().from(schema.adminInvites).where(eq(schema.adminInvites.id, inv.id)).limit(1);
    expect(row.tokenHash).not.toBe(inv.token);
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("aceita convite, cria usuário sem MFA (obrigado a configurar) e marca uso único", async () => {
    const email = `b-${Date.now()}@t.local`;
    const inv = await createInvite(db, { email, role: "atendimento", createdBy: superId });
    const res = await acceptInvite(db, { token: inv.token, password: "SenhaForte123!", name: "Novo" });
    expect(res.email).toBe(email);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, res.userId)).limit(1);
    expect(u.mfaEnabled).toBe(false);
    expect(u.role).toBe("atendimento");
    // reutilização — anti-reuso
    await expect(acceptInvite(db, { token: inv.token, password: "Outra12345!" })).rejects.toMatchObject({ code: "invite_used" });
  });

  it("rejeita convite expirado", async () => {
    const email = `c-${Date.now()}@t.local`;
    const inv = await createInvite(db, { email, role: "marketing", createdBy: superId });
    await db.update(schema.adminInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.adminInvites.id, inv.id));
    await expect(acceptInvite(db, { token: inv.token, password: "SenhaForte123!" })).rejects.toMatchObject({ code: "invite_expired" });
  });
});
