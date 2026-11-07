// language: TS, file: apps/api/src/services/sessions.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import {
  createSession,
  validateSession,
  rotateSession,
  revokeSession,
  listActiveSessions,
  hashToken,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "./sessions.js";
import { hashPassword } from "../lib/crypto.js";

let db: any;
let userId: string;
let user2Id: string;

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  // usuário de teste
  const email = `sess-${Date.now()}@test.local`;
  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: await hashPassword("Senha123!"),
      name: "Sessão Teste",
      role: "superadmin",
      active: true,
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning();
  if (u) userId = u.id;
  else {
    const found = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    userId = found[0].id;
  }
  const email2 = `sess2-${Date.now()}@test.local`;
  const [u2] = await db
    .insert(schema.users)
    .values({
      email: email2,
      passwordHash: await hashPassword("Senha123!"),
      name: "Sessão Teste 2",
      role: "atendimento",
      active: true,
    })
    .returning();
  user2Id = u2.id;
});

describe("B.1 — sessões em banco", () => {
  it("cria sessão opaca (256 bits), guarda só hash SHA-256 e valida", async () => {
    const created = await createSession(db, { userId, ip: "127.0.0.1", userAgent: "test" });
    expect(created.token).toBeTruthy();
    expect(created.token.length).toBeGreaterThanOrEqual(42); // base64url de 32 bytes
    expect(created.id).toBeTruthy();

    const row = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.id)))[0];
    expect(row.tokenHash).toBe(hashToken(created.token));
    expect(row.tokenHash).not.toBe(created.token);
    expect(row.refreshTokenHash).toBeTruthy();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.idleExpiresAt).toBeTruthy();

    const valid = await validateSession(db, created.token);
    expect(valid).not.toBeNull();
    expect(valid!.user.id).toBe(userId);
    expect(valid!.session.id).toBe(created.id);
  });

  it("token inválido não autentica", async () => {
    expect(await validateSession(db, "nao-existe")).toBeNull();
  });

  it("sessão revogada não autentica", async () => {
    const created = await createSession(db, { userId });
    expect(await revokeSession(db, created.id)).toBe(true);
    expect(await validateSession(db, created.token)).toBeNull();
  });

  it("sessão expirada (absoluta) não autentica", async () => {
    const created = await createSession(db, { userId });
    const past = new Date(Date.now() - 1000);
    await db.update(schema.sessions).set({ expiresAt: past }).where(eq(schema.sessions.id, created.id));
    expect(await validateSession(db, created.token)).toBeNull();
  });

  it("sessão expirada por ociosidade não autentica e rola quando ativa", async () => {
    const created = await createSession(db, { userId });
    // ativa: rola idle
    const beforeIdle = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.id)))[0].idleExpiresAt!;
    await new Promise((r) => setTimeout(r, 10));
    await validateSession(db, created.token);
    const after = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, created.id)))[0];
    expect(after.idleExpiresAt!.getTime()).toBeGreaterThanOrEqual(beforeIdle.getTime());
    expect(after.lastSeenAt).toBeTruthy();
    // expira idle
    await db.update(schema.sessions).set({ idleExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, created.id));
    expect(await validateSession(db, created.token)).toBeNull();
  });

  it("rotação no login/elevação: revoga a antiga e emite nova", async () => {
    const first = await createSession(db, { userId });
    const second = await rotateSession(db, first.id, { userId, mfaElevated: true });
    expect(second.token).not.toBe(first.token);
    expect(await validateSession(db, first.token)).toBeNull();
    const valid = await validateSession(db, second.token);
    expect(valid).not.toBeNull();
    expect(valid!.session.mfaVerifiedAt).toBeTruthy();
  });

  it("lista sessões ativas e revoga a própria; superadmin revoga de outro (regra de rota)", async () => {
    const a = await createSession(db, { userId: user2Id });
    const b = await createSession(db, { userId: user2Id });
    const list = await listActiveSessions(db, user2Id);
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(await revokeSession(db, a.id)).toBe(true);
    const list2 = await listActiveSessions(db, user2Id);
    expect(list2.map((s) => s.id)).not.toContain(a.id);
    // cleanup
    await revokeSession(db, b.id);
  });

  it("janela absoluta 8h e ociosa 30 min (constantes)", () => {
    expect(SESSION_ABSOLUTE_MS).toBe(8 * 60 * 60 * 1000);
    expect(SESSION_IDLE_MS).toBe(30 * 60 * 1000);
  });
});
