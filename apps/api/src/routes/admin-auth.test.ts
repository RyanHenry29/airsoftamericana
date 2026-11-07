// language: TS, file: apps/api/src/routes/admin-auth.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { createSession, ADMIN_SESSION_COOKIE } from "../services/sessions.js";
import { registerAdminRoutes } from "./admin.js";
import { registerMfaRoutes } from "./mfa.js";
import { csrfTokenFor } from "../lib/csrf.js";

let db: any;

async function makeApp() {
  const app = fastify();
  await app.register(cookie);
  app.decorate("db", db);
  registerAdminRoutes(app, db);
  registerMfaRoutes(app, db);
  await app.ready();
  return app;
}

async function createUser(role: string, emailPrefix: string) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: await hashPassword("Senha123!"),
      name: "Teste",
      role,
      active: true,
      mfaEnabled: true,
    })
    .returning();
  const sess = await createSession(db, { userId: u.id, mfaVerified: true });
  return { user: u, session: sess, csrf: csrfTokenFor(sess.token) };
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
});

describe("FASE 2 — convites (API)", () => {
  it("superadmin lista e revoga convites; não-superadmin é barrado", async () => {
    const app = await makeApp();
    const superA = await createUser("superadmin", "inv-super");
    const other = await createUser("atendimento", "inv-at");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/invites",
      cookies: { [ADMIN_SESSION_COOKIE]: superA.session.token },
      headers: { "x-csrf-token": superA.csrf },
      payload: { email: `novo-${Date.now()}@test.local`, role: "estoque" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().invite;
    expect(created.token).toBeTruthy();

    const listRes = await app.inject({
      method: "GET",
      url: "/api/admin/invites",
      cookies: { [ADMIN_SESSION_COOKIE]: superA.session.token },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items.some((i: any) => i.id === created.id)).toBe(true);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/invites",
      cookies: { [ADMIN_SESSION_COOKIE]: other.session.token },
    });
    expect(forbidden.statusCode).toBe(403);

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/admin/invites/${created.id}`,
      cookies: { [ADMIN_SESSION_COOKIE]: superA.session.token },
      headers: { "x-csrf-token": superA.csrf },
    });
    expect(delRes.statusCode).toBe(200);
    await app.close();
  });
});

describe("FASE 2 — sessões (API)", () => {
  it("revoga todas as outras sessões com confirmação", async () => {
    const app = await makeApp();
    const { user, session, csrf } = await createUser("atendimento", "sess");
    await createSession(db, { userId: user.id, mfaVerified: true });
    await createSession(db, { userId: user.id, mfaVerified: true });

    const noConfirm = await app.inject({
      method: "POST",
      url: "/api/admin/sessions/revoke-others",
      cookies: { [ADMIN_SESSION_COOKIE]: session.token },
      headers: { "x-csrf-token": csrf },
      payload: {},
    });
    expect(noConfirm.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST",
      url: "/api/admin/sessions/revoke-others",
      cookies: { [ADMIN_SESSION_COOKIE]: session.token },
      headers: { "x-csrf-token": csrf },
      payload: { confirm: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().revoked).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});

describe("FASE 2 — papéis/usuários (API)", () => {
  it("bloqueia autoelevação/alteração do próprio papel", async () => {
    const app = await makeApp();
    const superA = await createUser("superadmin", "self");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${superA.user.id}`,
      cookies: { [ADMIN_SESSION_COOKIE]: superA.session.token },
      headers: { "x-csrf-token": superA.csrf },
      payload: { role: "atendimento" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("rebaixa superadmin quando há outro ativo; bloqueio de autoalteração impede remover o último via si", async () => {
    const app = await makeApp();
    const s1 = await createUser("superadmin", "last1");
    const s2 = await createUser("superadmin", "last2");
    const demote1 = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${s2.user.id}`,
      cookies: { [ADMIN_SESSION_COOKIE]: s1.session.token },
      headers: { "x-csrf-token": s1.csrf },
      payload: { role: "gerente" },
    });
    expect(demote1.statusCode).toBe(200);
    expect(demote1.json().user.role).toBe("gerente");
    // tentativa de autoalteração segue bloqueada
    const self = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${s1.user.id}`,
      cookies: { [ADMIN_SESSION_COOKIE]: s1.session.token },
      headers: { "x-csrf-token": s1.csrf },
      payload: { role: "gerente" },
    });
    expect(self.statusCode).toBe(403);
    await app.close();
  });
});

describe("FASE 2 — passkeys CRUD (API)", () => {
  it("lista, renomeia e remove passkey própria (com sessão MFA recente)", async () => {
    const app = await makeApp();
    const { user, session, csrf } = await createUser("atendimento", "pk");
    const [cred] = await db
      .insert(schema.webauthnCredentials)
      .values({
        userId: user.id,
        credentialId: `cred-mgmt-${Date.now()}`,
        publicKey: "cHVia2V5",
        counter: 0,
        label: "Original",
      })
      .returning();

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/mfa/webauthn/credentials",
      cookies: { [ADMIN_SESSION_COOKIE]: session.token },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.some((i: any) => i.id === cred.id)).toBe(true);

    // reauth_required se sessão não recente — força mfaVerifiedAt antigo
    await db.update(schema.sessions).set({ mfaVerifiedAt: new Date(Date.now() - 10 * 60 * 1000) }).where(eq(schema.sessions.id, session.id));
    // recria sessão token state? validateSession rolls idle but keeps mfaVerifiedAt; inject uses cookie token -> auth middleware loads session
    const renameBlocked = await app.inject({
      method: "PATCH",
      url: `/api/admin/mfa/webauthn/credentials/${cred.id}`,
      cookies: { [ADMIN_SESSION_COOKIE]: session.token },
      headers: { "x-csrf-token": csrf },
      payload: { label: "Novo" },
    });
    expect(renameBlocked.statusCode).toBe(403);
    expect(renameBlocked.json().error.code).toBe("reauth_required");

    // restaura recente
    await db.update(schema.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(schema.sessions.id, session.id));
    const renameOk = await app.inject({
      method: "PATCH",
      url: `/api/admin/mfa/webauthn/credentials/${cred.id}`,
      cookies: { [ADMIN_SESSION_COOKIE]: session.token },
      headers: { "x-csrf-token": csrf },
      payload: { label: "Notebook" },
    });
    expect(renameOk.statusCode).toBe(200);
    expect(renameOk.json().label).toBe("Notebook");

    const delOk = await app.inject({
      method: "DELETE",
      url: `/api/admin/mfa/webauthn/credentials/${cred.id}`,
      cookies: { [ADMIN_SESSION_COOKIE]: session.token },
      headers: { "x-csrf-token": csrf },
      payload: {},
    });
    expect(delOk.statusCode).toBe(200);
    await app.close();
  });
});
