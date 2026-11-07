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
import { CSV_MAX_BYTES } from "../services/catalog-import.js";

let db: any;
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const CAT_SLUG = `cat-csv-${RUN}`;
const BRAND_SLUG = `brand-csv-${RUN}`;

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
  const app = fastify({ bodyLimit: CSV_MAX_BYTES + 65536 });
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

async function previewApply(app: any, auth: { token: string; csrf: string }, file: string, extra: any = {}) {
  const p = await app.inject({
    method: "POST",
    url: "/api/admin/catalog/import/preview",
    cookies: { aa_session: auth.token },
    headers: { "x-csrf-token": auth.csrf },
    payload: { file, ...extra },
  });
  const prev = p.json();
  if (p.statusCode !== 200 || prev.invalid > 0 || prev.errors?.some((e: any) => ["file_too_large", "invalid_extension", "invalid_mime", "empty_file", "missing_header"].includes(e.code))) {
    return { p, prev, a: null, applied: null };
  }
  const a = await app.inject({
    method: "POST",
    url: "/api/admin/catalog/import/apply",
    cookies: { aa_session: auth.token },
    headers: { "x-csrf-token": auth.csrf },
    payload: { file, checksum: prev.checksum, ...extra },
  });
  return { p, prev, a, applied: a.json() };
}

beforeAll(async () => {
  db = await getDb();
  await migrate(db);
  await db.insert(schema.categories).values({
    name: `[DEMO] Cat CSV ${RUN}`,
    slug: CAT_SLUG,
    description: "",
    ageRestricted: false,
    active: true,
    position: 0,
  });
  await db.insert(schema.brands).values({
    name: `[DEMO] Brand CSV ${RUN}`,
    slug: BRAND_SLUG,
    description: "",
    active: true,
    position: 0,
  });
});

describe("FASE 3B — catalog import CSV (2 etapas, transacional)", () => {
  it("CSV válido: preview não aplica; confirmação aplica (cria)", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const sku = `SKU-NEW-${RUN}`;
    const file = `slug;nome;sku;preco;category_slug\ncsv-prod-${RUN};[DEMO] Produto 1;${sku};99.90;${CAT_SLUG}`;
    const p = await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file } });
    expect(p.statusCode).toBe(200);
    const prev = p.json();
    expect(prev.valid).toBe(1);
    expect(prev.wouldCreate).toBe(1);
    expect(prev.checksum).toBeTruthy();
    // não aplicou ainda
    const mid = await db.select().from(schema.productVariants).where(eq(schema.productVariants.sku, sku)).limit(1);
    expect(mid.length).toBe(0);
    const a = await app.inject({ method: "POST", url: "/api/admin/catalog/import/apply", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file, checksum: prev.checksum } });
    expect(a.statusCode).toBe(200);
    expect(a.json().created).toBe(1);
    await app.close();
  });

  it("cabeçalho ausente/inválido: preview reporta erro claro e não aplica", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    // linha única sem colunas mínimas reconhecíveis como dados legados? "abc" -> legado posicional mas <5 campos => erro por linha
    // para forçar missing_header com header-like: header com sku mas sem slug/nome
    const file = `sku;preco\nX-${RUN};10`;
    const p = await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file } });
    const prev = p.json();
    expect(p.statusCode).toBe(200);
    expect(prev.errors.some((e: any) => e.code === "missing_header" || /cabeçalho|obrigat/i.test(e.message))).toBe(true);
    await app.close();
  });

  it("coluna desconhecida é ignorada com aviso (não quebra)", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const file = `slug;nome;sku;preco;category_slug;coluna_xyz\nunk-${RUN};[DEMO] U;SKU-UNK-${RUN};10.00;${CAT_SLUG};zzz`;
    const { p, prev } = await previewApply(app, auth, file);
    expect(p.statusCode).toBe(200);
    expect(prev.warnings.some((w: string) => /desconhecid/i.test(w))).toBe(true);
    expect(prev.valid).toBe(1);
    await app.close();
  });

  it("linha inválida / preço inválido / estoque inválido / condição inválida reportados por linha; confirmação não aplica parcial", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const file = [
      "slug;nome;sku;preco;category_slug;estoque;condicao",
      `ok-${RUN};[DEMO] Ok;SKU-OKP-${RUN};10.00;${CAT_SLUG};5;novo`,
      `badp-${RUN};[DEMO] BadP;SKU-BADP-${RUN};abc;${CAT_SLUG};5;novo`,
      `bads-${RUN};[DEMO] BadS;SKU-BADS-${RUN};10.00;${CAT_SLUG};-1;novo`,
      `badc-${RUN};[DEMO] BadC;SKU-BADC-${RUN};10.00;${CAT_SLUG};5;quebrado`,
    ].join("\n");
    const p = await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file } });
    const prev = p.json();
    expect(prev.invalid).toBe(3);
    expect(prev.errors.some((e: any) => e.code === "invalid_price")).toBe(true);
    expect(prev.errors.some((e: any) => e.code === "negative_stock")).toBe(true);
    expect(prev.errors.some((e: any) => e.code === "invalid_condition")).toBe(true);
    // confirmação com erros de validação não aplica nada
    const a = await app.inject({ method: "POST", url: "/api/admin/catalog/import/apply", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file, checksum: prev.checksum } });
    expect(a.json().created).toBe(0);
    expect(a.json().updated).toBe(0);
    expect(a.json().rejected).toBeGreaterThan(0);
    await app.close();
  });

  it("SKU duplicado no arquivo reportado; existente no banco => ação update (sem sobrescrita silenciosa)", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const dup = `SKU-DUPF-${RUN}`;
    const fileDup = `slug;nome;sku;preco;category_slug\nd1-${RUN};A;${dup};10;${CAT_SLUG}\nd2-${RUN};B;${dup};20;${CAT_SLUG}`;
    const pdup = await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: fileDup } });
    expect(pdup.json().errors.some((e: any) => e.code === "duplicate_sku_file")).toBe(true);

    const sku = `SKU-UPD3-${RUN}`;
    await previewApply(app, auth, `slug;nome;sku;preco;category_slug\np-up-${RUN};[DEMO] Base;${sku};100.00;${CAT_SLUG}`);
    const fileUpd = `slug;nome;sku;preco;category_slug\np-up-${RUN};[DEMO] Atualizado;${sku};149.90;${CAT_SLUG}`;
    const prev = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: fileUpd } })).json();
    expect(prev.wouldUpdate).toBe(1);
    expect(prev.wouldCreate).toBe(0);
    const a = await app.inject({ method: "POST", url: "/api/admin/catalog/import/apply", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: fileUpd, checksum: prev.checksum } });
    expect(a.json().updated).toBe(1);
    const [v] = await db.select().from(schema.productVariants).where(eq(schema.productVariants.sku, sku)).limit(1);
    expect(v.priceCents).toBe(14990);
    await app.close();
  });

  it("categoria inexistente / marca inexistente reportados", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const file = `slug;nome;sku;preco;category_slug;brand_slug\ncx-${RUN};X;SKU-CX-${RUN};10;nao-existe-${RUN};marca-nao-${RUN}`;
    const prev = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file } })).json();
    expect(prev.errors.some((e: any) => e.code === "category_not_found")).toBe(true);
    expect(prev.errors.some((e: any) => e.code === "brand_not_found")).toBe(true);
    await app.close();
  });

  it("permissão insuficiente negada (preview/apply); estoque autorizado", async () => {
    for (const role of ["somente-leitura", "atendimento", "financeiro"]) {
      const auth = await makeAuthed(role);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: `s;n;k;p;c\nx;x;SKU-NO-${role}-${RUN};1;${CAT_SLUG}` } });
      expect(res.statusCode).toBe(403);
      await app.close();
    }
    const ok = await makeAuthed("estoque");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: ok.token } as any, headers: { "x-csrf-token": ok.csrf }, payload: { file: `slug;nome;sku;preco;category_slug\nperm-${RUN};[DEMO];SKU-PERM-${RUN};5.00;${CAT_SLUG}` } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rollback transacional: falha de aplicação não grava alterações parciais", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    // cria categoria temporária, faz preview válido, remove categoria, aplica => rollback sem criar
    const tmpSlug = `tmp-rb-${RUN}`;
    await db.insert(schema.categories).values({ name: `[DEMO] Tmp`, slug: tmpSlug, active: true, position: 0 } as any);
    const sku = `SKU-RB-${RUN}`;
    const file = `slug;nome;sku;preco;category_slug\nrb-${RUN};[DEMO] RB;${sku};10;${tmpSlug}`;
    const prev = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file } })).json();
    expect(prev.valid).toBe(1);
    await db.delete(schema.categories).where(eq(schema.categories.slug, tmpSlug));
    const a = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/apply", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file, checksum: prev.checksum } })).json();
    expect(a.created).toBe(0);
    expect(a.updated).toBe(0);
    expect(a.errors.length).toBeGreaterThan(0);
    const row = await db.select().from(schema.productVariants).where(eq(schema.productVariants.sku, sku)).limit(1);
    expect(row.length).toBe(0);
    await app.close();
  });

  it("arquivo acima do limite / MIME inválido / extensão inválida rejeitados", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const big = "x".repeat(CSV_MAX_BYTES + 10);
    const rBig = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: big, filename: "a.csv" } })).json();
    expect(rBig.errors.some((e: any) => e.code === "file_too_large")).toBe(true);
    const rMime = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: "a;b", filename: "a.csv", mime: "application/x-msdownload" } })).json();
    expect(rMime.errors.some((e: any) => e.code === "invalid_mime")).toBe(true);
    const rExt = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: "a;b", filename: "a.exe" } })).json();
    expect(rExt.errors.some((e: any) => e.code === "invalid_extension")).toBe(true);
    await app.close();
  });

  it("fórmula maliciosa (= + - @) neutralizada com aviso", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const sku = `SKU-FRM-${RUN}`;
    const file = `slug;nome;sku;preco;category_slug\nfrm-${RUN};=HYPERLINK("x");${sku};10.00;${CAT_SLUG}`;
    const { prev, applied } = await previewApply(app, auth, file);
    expect(prev.warnings.some((w: string) => /fórmula|formula|neutraliz/i.test(w))).toBe(true);
    expect(applied?.created).toBe(1);
    const [p] = await db.select().from(schema.products).where(eq(schema.products.slug, `frm-${RUN}`)).limit(1);
    expect(String(p.name).startsWith("'=") || String(p.name).includes("HYPERLINK")).toBe(true); // neutralizado (prefixado) ou preservado seguro
    expect(String(p.name).startsWith("=")).toBe(false);
    await app.close();
  });

  it("importação vazia rejeitada com erro claro", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const prev = (await app.inject({ method: "POST", url: "/api/admin/catalog/import/preview", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: "   \n\n" } })).json();
    expect(prev.errors.some((e: any) => e.code === "empty_file")).toBe(true);
    await app.close();
  });

  it("endpoint legado não aplica (exige 2 etapas)", async () => {
    const auth = await makeAuthed("superadmin");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/admin/catalog/import", cookies: { aa_session: auth.token }, headers: { "x-csrf-token": auth.csrf }, payload: { file: "a;b;c;d;e" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe("use_two_step_import");
    await app.close();
  });
});
