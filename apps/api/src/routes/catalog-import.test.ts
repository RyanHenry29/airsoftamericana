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

async function makeAuthed(role: string) {
  const email = `csv-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@t.local`;
  const [u] = await db.insert(schema.users).values({
    email, passwordHash: await hashPassword("Senha123!"), name: role, role, active: true, mfaEnabled: true,
  }).returning();
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
  // categoria de referência para o CSV
  await db.insert(schema.categories).values({
    name: "Cat CSV", slug: "cat-csv", description: "", ageRestricted: false, active: true, position: 0,
  }).onConflictDoNothing({ target: schema.categories.slug });
});

describe("catalog import CSV (admin)", () => {
  it("CSV válido cria itens", async () => {
    const { token, csrf } = await makeAuthed("superadmin");
    const app = await buildApp();
    const file = "slug;nome;sku;preco;categorySlug\ncsv-prod-1;Produto 1;SKU-CSV-1;99.90;cat-csv";
    const res = await app.inject({
      method: "POST", url: "/api/admin/catalog/import",
      cookies: { aa_session: token }, headers: { "x-csrf-token": csrf },
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
    const file = [
      "slug;nome;sku;preco;categorySlug",
      "ruim", // inválida
      "p2;Prod 2;SKU-CSV-ERR;10.00;nao-existe", // categoria inexistente
      "p3;Prod 3;SKU-CSV-OK;20.00;cat-csv", // válida
    ].join("\n");
    const res = await app.inject({
      method: "POST", url: "/api/admin/catalog/import",
      cookies: { aa_session: token }, headers: { "x-csrf-token": csrf },
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
    // SKU-CSV-1 já criado no primeiro teste
    const file = "p-upd;Produto 1 Atualizado;SKU-CSV-1;149.90;cat-csv";
    const res = await app.inject({
      method: "POST", url: "/api/admin/catalog/import",
      cookies: { aa_session: token }, headers: { "x-csrf-token": csrf },
      payload: { file },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(1);
    const [v] = await db.select().from(schema.productVariants).where(eq(schema.productVariants.sku, "SKU-CSV-1")).limit(1);
    expect(v.priceCents).toBe(14990);
    await app.close();
  });

  it("SKU duplicado no arquivo é reportado como erro", async () => {
    const { token, csrf } = await makeAuthed("superadmin");
    const app = await buildApp();
    const file = [
      "d1;Dup 1;SKU-DUP-1;10.00;cat-csv",
      "d2;Dup 2;SKU-DUP-1;20.00;cat-csv", // duplicado no arquivo
    ].join("\n");
    const res = await app.inject({
      method: "POST", url: "/api/admin/catalog/import",
      cookies: { aa_session: token }, headers: { "x-csrf-token": csrf },
      payload: { file },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors.some((e: any) => /duplicado/i.test(e.message))).toBe(true);
    // primeira ocorrência processada, segunda rejeitada
    expect(body.created).toBe(1);
    await app.close();
  });

  it("permissão por papel: sem products:update é negado; com products:update é permitido", async () => {
    const deniedRoles = ["somente-leitura", "atendimento", "financeiro"]; // não têm products update
    for (const role of deniedRoles) {
      const { token, csrf } = await makeAuthed(role);
      const app = await buildApp();
      const res = await app.inject({
        method: "POST", url: "/api/admin/catalog/import",
        cookies: { aa_session: token }, headers: { "x-csrf-token": csrf },
        payload: { file: "x;x;SKU-NO;1.00;cat-csv" },
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    }
    // permitido: estoque tem products update
    const ok = await makeAuthed("estoque");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/api/admin/catalog/import",
      cookies: { aa_session: ok.token } as any,
      headers: { "x-csrf-token": ok.csrf },
      payload: { file: "perm;Perm;SKU-PERM;5.00;cat-csv" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
