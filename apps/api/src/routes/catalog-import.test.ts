// language: TS, file: apps/api/src/routes/catalog-import.test.ts, target: vitest
import { describe, it, expect, beforeAll } from "vitest";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { schema } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { createSession } from "../services/sessions.js";
import { csrfGuard, csrfTokenForSession } from "../lib/csrf.js";
import { authMiddleware } from "../middleware/auth.js";
import { registerAdminRoutes } from "./admin.js";

let db: any;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const CAT_SLUG = `cat-csv-${RUN}`;

async function makeAuthed(role: string) {
  const email = `csv-${role}-${RUN}-${Math.random().toString(36).slice(2)}@t.local`;
  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: await hashPassword("Senha123!"),
      name: role,
      role,
      active: true,
      mfaEnabled: true,
    })
    .returning();
  const s = await createSession(db, { userId: u.id, mfaVerified: true });
  return { token: s.token, csrf: csrfTokenForSession(s.id) };
}

async function buildApp() {
  const app = fastify();
  await app.register(cookie);
  app.decorate("db", db);
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin")) await authMiddleware(req as any);
  });
  app.addHook("preHandler", csrfGuard);
  registerAdminRoutes(app, db);
  await app.ready();
  return app;
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  await db.insert(schema.categories).values({
    name: `Cat CSV ${RUN}`,
    slug: CAT_SLUG,
    description: "",
    ageRestricted: false,
    active: true,
    position: 0,
  });
});

describe("catalog import CSV (admin)", () => {
  it("CSV válido cria itens", async () => {
    const { token, csrf } = await makeAuthed("superadmin");
    const app = await buildApp();
    const sku = `SKU-NEW-${RUN}`;
    const file = `slug;nome;sku;preco;categorySlug\ncsv-prod-${RUN};Produto 1;${sku};99.90;${CAT_SLUG}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/catalog/import",
      cookies: { aa_session: token },
      headers: { "x-csrf-token": csrf },
      payload: { file },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(1);
    expect(body.errors).toEqual([]);
    await app.close();
  });

  it("linha com erro (categoria inexistente / formato inválido) reporta erro sem quebrar", async () => {
    const { token, csrf } = await makeAuthed("gerente");
    const app = await buildApp();
    const skuOk = `SKU-OK-${RUN}`;
    const file = [
      "slug;nome;sku;preco;categorySlug",
      "ruim", // inválida
      `p2-${RUN};Prod 2;SKU-ERR-${RUN};10.00;nao-existe-${RUN}`, // categoria inexistente
      `p3-${RUN};Prod 3;${skuOk};20.00;${CAT_SLUG}`, // válida
    ].join("\n");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/catalog/import",
      cookies: { aa_session: token },
      headers: { "x-csrf-token": csrf },
      payload: { file },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
    expect(body.created).toBe(1);
    await app.close();
  });

  it("atualização por SKU existente", async () => {
    const { token, csrf } = await makeAuthed("superadmin");
    const app = await buildApp();
    const sku = `SKU-UPD-${RUN}`;
    // cria primeiro
    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/catalog/import",
      cookies: { aa_session: token },
      headers: { "x-csrf-token": csrf },
      payload: { file: `p-upd-${RUN};Produto Base;${sku};100.00;${CAT_SLUG}` },
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().created).toBe(1);
    // atualiza pelo mesmo SKU
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/catalog/import",
      cookies: { aa_session: token },
      headers: { "x-csrf-token": csrf },
      payload: { file: `p-upd-${RUN};Produto Atualizado;${sku};149.90;${CAT_SLUG}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(1);
    const [v] = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.sku, sku))
      .limit(1);
    expect(v.priceCents).toBe(14990);
    await app.close();
  });

  it("SKU duplicado no arquivo é reportado como erro", async () => {
    const { token, csrf } = await makeAuthed("superadmin");
    const app = await buildApp();
    const dup = `SKU-DUP-${RUN}`;
    const file = [
      `d1-${RUN};Dup 1;${dup};10.00;${CAT_SLUG}`,
      `d2-${RUN};Dup 2;${dup};20.00;${CAT_SLUG}`, // duplicado no arquivo
    ].join("\n");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/catalog/import",
      cookies: { aa_session: token },
      headers: { "x-csrf-token": csrf },
      payload: { file },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors.some((e: any) => /duplicado/i.test(e.message))).toBe(true);
    expect(body.created).toBe(1);
    await app.close();
  });

  it("permissão por papel: sem products:update é negado; com products:update é permitido", async () => {
    const deniedRoles = ["somente-leitura", "atendimento", "financeiro"];
    for (const role of deniedRoles) {
      const { token, csrf } = await makeAuthed(role);
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/catalog/import",
        cookies: { aa_session: token },
        headers: { "x-csrf-token": csrf },
        payload: { file: `x-${role};x;SKU-NO-${role}-${RUN};1.00;${CAT_SLUG}` },
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    }
    const ok = await makeAuthed("estoque");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/catalog/import",
      cookies: { aa_session: ok.token } as any,
      headers: { "x-csrf-token": ok.csrf },
      payload: { file: `perm-${RUN};Perm;SKU-PERM-${RUN};5.00;${CAT_SLUG}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
