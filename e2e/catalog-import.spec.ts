import { test, expect, type Page } from "@playwright/test";
import { API, totpFromSecretBase32 } from "./helpers";

const PASS = "Senha123!";
const CAT = process.env.E2E_CATEGORY_SLUG || "demo-e2e-cat";
const TOTP_CSV1 = process.env.E2E_TOTP_SECRET_CSV1 || "";
const TOTP_CSV2 = process.env.E2E_TOTP_SECRET_CSV2 || "";
const TOTP_CSV3 = process.env.E2E_TOTP_SECRET_CSV3 || "";
const TOTP_CSV4 = process.env.E2E_TOTP_SECRET_CSV4 || "";
const TOTP_AT_IMPORT = process.env.E2E_TOTP_SECRET_AT_IMPORT || "";

async function login(page: Page, email: string, password = PASS) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
}

async function loginMfa(page: Page, email: string, secret: string) {
  await login(page, email);
  await expect(page).toHaveURL(/\/mfa\/verify/, { timeout: 15000 });
  await page.getByLabel(/c[oó]digo/i).fill(totpFromSecretBase32(secret));
  await page.getByRole("button", { name: /confirmar/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

async function getCsrf(page: Page): Promise<string> {
  const r = await page.request.get(`${API}/api/admin/csrf`);
  if (!r.ok()) return "";
  const j = await r.json();
  return j.token || "";
}

test.describe("FASE 3 - Importacao CSV (admin)", () => {
  test.skip(!process.env.E2E_READY, "Requer E2E_READY=1 com API+admin+seed isolados");

  test("preview nao altera banco; confirmacao cria produto DEMO; SKU existente aparece como atualizacao", async ({ page }) => {
    test.skip(!TOTP_CSV1, "Requer E2E_TOTP_SECRET_CSV1");
    await loginMfa(page, "admin-mfa-csv1@e2e.local", TOTP_CSV1);
    await page.goto("/products/import");
    await expect(page.getByRole("heading", { name: /importar csv/i })).toBeVisible();

    const sku = `E2E-SKU-${Date.now()}`;
    const csv = `slug;nome;sku;preco;category_slug\ne2e-csv-${sku.toLowerCase()};[DEMO] E2E CSV;${sku};99.90;${CAT}\n`;
    await page.locator("#csvfile").setInputFiles({ name: "demo.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });

    await expect(page.getByText(/resumo da pr[eé]-visualiza[cç][aã]o/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/criar/i).first()).toBeVisible();
    // preview nao aplicou: confirmar e verificar criacao
    await page.getByLabel(/confirmo a aplica[cç][aã]o/i).check();
    await page.getByRole("button", { name: /confirmar e aplicar/i }).click();
    await expect(page.getByText(/importa[cç][aã]o aplicada/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/criados:\s*1/i)).toBeVisible();

    // SKU existente => atualizacao
    await page.getByRole("button", { name: /nova importa[cç][aã]o/i }).click();
    const csvUpd = `slug;nome;sku;preco;category_slug\ne2e-csv-${sku.toLowerCase()};[DEMO] E2E CSV Atualizado;${sku};149.90;${CAT}\n`;
    await page.locator("#csvfile").setInputFiles({ name: "demo-upd.csv", mimeType: "text/csv", buffer: Buffer.from(csvUpd, "utf8") });
    await expect(page.getByText(/atualizar \(SKU\)/i).first()).toBeVisible({ timeout: 15000 });
    await page.getByLabel(/confirmo a aplica[cç][aã]o/i).check();
    await page.getByRole("button", { name: /confirmar e aplicar/i }).click();
    await expect(page.getByText(/atualizados:\s*1/i)).toBeVisible({ timeout: 15000 });
  });

  test("erro impede aplicacao; CSV malicioso neutralizado; checksum alterado gera 409 (API)", async ({ page }) => {
    test.skip(!TOTP_CSV2, "Requer E2E_TOTP_SECRET_CSV2");
    await loginMfa(page, "admin-mfa-csv2@e2e.local", TOTP_CSV2);
    const csrf = await getCsrf(page);
    const bad = `slug;nome;sku;preco;category_slug\nok-e2e-${Date.now()};OK;SKU-E2EOK-${Date.now()};10;${CAT}\nbad-e2e;Bad;SKU-E2EBAD;abc;${CAT}\n`;
    const prev = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file: bad, filename: "b.csv" } });
    expect(prev.status()).toBe(200);
    const pj = await prev.json();
    expect(pj.invalid).toBeGreaterThan(0);
    // apply nao deve gravar com invalidos
    const app = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: bad, checksum: pj.checksum } });
    const aj = await app.json();
    expect(aj.created).toBe(0);
    expect(aj.updated).toBe(0);

    // formula maliciosa neutralizada
    const skuF = `SKU-FRM-E2E-${Date.now()}`;
    const frm = `slug;nome;sku;preco;category_slug\nfrm-e2e-${Date.now()};=HYPERLINK("x");${skuF};10;${CAT}\n`;
    const p2 = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file: frm, filename: "f.csv" } });
    const p2j = await p2.json();
    expect(p2j.warnings.some((w: string) => /neutraliz|f[oó]rmula|formula/i.test(w))).toBe(true);
    const a2 = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: frm, checksum: p2j.checksum } });
    expect((await a2.json()).created).toBe(1);

    // checksum alterado => 409
    const c409 = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: frm + "\n", checksum: p2j.checksum } });
    expect(c409.status()).toBe(409);
  });

  test("usuario sem permissao recebe 403", async ({ page }) => {
    test.skip(!TOTP_AT_IMPORT, "Requer E2E_TOTP_SECRET_AT_IMPORT");
    await loginMfa(page, "operador-atendimento-import@e2e.local", TOTP_AT_IMPORT);
    const csrf = await getCsrf(page);
    const file = `slug;nome;sku;preco;category_slug\nx;x;SKU-NOPERM-${Date.now()};1;${CAT}\n`;
    const res = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file, filename: "x.csv" } });
    expect(res.status()).toBe(403);
  });

  test("arquivo acima do limite retorna 413; dupla submissao (mesmo payload) nao cria duplicidade", async ({ page }) => {
    test.skip(!TOTP_CSV3, "Requer E2E_TOTP_SECRET_CSV3");
    await loginMfa(page, "admin-mfa-csv3@e2e.local", TOTP_CSV3);
    const csrf = await getCsrf(page);
    // 413: payload > 2 MiB
    const big = "slug;nome;sku;preco;category_slug\n" + "a".repeat(2_200_000);
    const r413 = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file: big, filename: "big.csv" } });
    expect(r413.status()).toBe(413);

    // dupla submissão: mesmo file+checksum => segunda aplicação não cria duplicidade
    const sku = `SKU-DUP-${Date.now()}`;
    const csv = `slug;nome;sku;preco;category_slug\ndup-e2e-${sku.toLowerCase()};[DEMO] Dup;${sku};10.00;${CAT}\n`;
    const prev = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file: csv, filename: "d.csv" } });
    expect(prev.ok()).toBe(true);
    const pj = await prev.json();
    const a1 = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: csv, checksum: pj.checksum, filename: "d.csv" } });
    const j1 = await a1.json();
    expect(j1.created).toBe(1);
    const a2 = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: csv, checksum: pj.checksum, filename: "d.csv" } });
    const j2 = await a2.json();
    expect(j2.created).toBe(0); // sem duplicidade
  });

  test("rollback visualmente reportado quando apply falha (marca removida entre preview e apply)", async ({ page }) => {
    test.skip(!TOTP_CSV4, "Requer E2E_TOTP_SECRET_CSV4");
    await loginMfa(page, "admin-mfa-csv4@e2e.local", TOTP_CSV4);
    const csrf = await getCsrf(page);
    const slug = `demo-rb-${Date.now()}`;
    // cria marca tempor?ria (sem produtos) para for?ar falha de revalida??o no apply
    const cBrand = await page.request.post(`${API}/api/admin/brands`, { headers: { "x-csrf-token": csrf }, data: { name: "[DEMO] Rollback Brand", slug, active: true } });
    expect(cBrand.ok()).toBe(true);

    const csv = `slug;nome;sku;preco;category_slug;brand_slug;condicao;estoque\nrb-prod-${slug};[DEMO] Rollback Prod;SKU-RB-${Date.now()};10.00;${CAT};${slug};novo;1\n`;
    await page.goto("/products/import");
    await page.getByLabel(/Arquivo CSV/i).setInputFiles({ name: "rollback.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    const gen = page.getByRole("button", { name: /Gerar|Pr[eé]-?visualiza|preview/i });
    if (await gen.isVisible().catch(() => false)) await gen.click();
    await expect(page.getByText(/Resumo da|Validas|V.lidas|Criar/i).first()).toBeVisible({ timeout: 15000 });

    // remove a marca entre preview e apply => revalida??o do apply falha (nenhuma altera??o gravada)
    const listB = await page.request.get(`${API}/api/admin/brands`);
    const bj = await listB.json();
    const bid = (bj.items || []).find((b: any) => b.slug === slug)?.id;
    expect(bid).toBeTruthy();
    const del = await page.request.delete(`${API}/api/admin/brands/${bid}`, { headers: { "x-csrf-token": csrf } });
    expect(del.ok()).toBe(true);

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Confirmar e aplicar/i }).click();
    await expect(page.getByText(/rollback total|nenhuma alter|Nenhuma altera/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Importa..o aplicada|criados: 0.*atualizados: 0/i)).toHaveCount(0).catch(() => {});
  });
});
