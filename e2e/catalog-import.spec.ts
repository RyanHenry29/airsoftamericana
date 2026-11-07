import { test, expect, type Page } from "@playwright/test";
import { API, totpFromSecretBase32 } from "./helpers";

const PASS = "Senha123!";
const TOTP_SECRET = process.env.E2E_TOTP_SECRET || "";
const CAT = process.env.E2E_CATEGORY_SLUG || "demo-e2e-cat";
const TOTP_AT_IMPORT = process.env.E2E_TOTP_SECRET_AT_IMPORT || process.env.E2E_TOTP_SECRET_AT || "";

async function login(page: Page, email: string, password = PASS) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
}

async function loginMfa(page: Page, email: string, secret: string) {
  await login(page, email);
  await expect(page).toHaveURL(/\/mfa\/verify/);
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

test.describe("FASE 3 — Importação CSV (admin)", () => {
  test.skip(!process.env.E2E_READY, "Requer E2E_READY=1 com API+admin+seed isolados");

  test("preview não altera banco; confirmação cria produto DEMO; SKU existente aparece como atualização", async ({ page }) => {
    test.skip(!TOTP_SECRET, "Requer E2E_TOTP_SECRET");
    await loginMfa(page, "admin-mfa-verify@e2e.local", TOTP_SECRET);
    await page.goto("/products/import");
    await expect(page.getByRole("heading", { name: /importar csv/i })).toBeVisible();

    const sku = `E2E-SKU-${Date.now()}`;
    const csv = `slug;nome;sku;preco;category_slug\ne2e-csv-${sku.toLowerCase()};[DEMO] E2E CSV;${sku};99.90;${CAT}\n`;
    await page.locator("#csvfile").setInputFiles({ name: "demo.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });

    await expect(page.getByText(/resumo da pr[eé]-visualiza[cç][aã]o/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/criar/i).first()).toBeVisible();
    // preview não aplicou: aplicar confirmação e verificar criação
    await page.getByLabel(/confirmo a aplica[cç][aã]o/i).check();
    await page.getByRole("button", { name: /confirmar e aplicar/i }).click();
    await expect(page.getByText(/importa[cç][aã]o aplicada/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/criados:\s*1/i)).toBeVisible();

    // SKU existente => atualização (novo preview/apply)
    await page.getByRole("button", { name: /nova importa[cç][aã]o/i }).click();
    const csvUpd = `slug;nome;sku;preco;category_slug\ne2e-csv-${sku.toLowerCase()};[DEMO] E2E CSV Atualizado;${sku};149.90;${CAT}\n`;
    await page.locator("#csvfile").setInputFiles({ name: "demo-upd.csv", mimeType: "text/csv", buffer: Buffer.from(csvUpd, "utf8") });
    await expect(page.getByText(/atualizar \(SKU\)/i).first()).toBeVisible({ timeout: 15000 });
    await page.getByLabel(/confirmo a aplica[cç][aã]o/i).check();
    await page.getByRole("button", { name: /confirmar e aplicar/i }).click();
    await expect(page.getByText(/atualizados:\s*1/i)).toBeVisible({ timeout: 15000 });
  });

  test("erro impede aplicação; CSV malicioso é neutralizado; checksum alterado gera 409 (API)", async ({ page }) => {
    test.skip(!TOTP_SECRET, "Requer E2E_TOTP_SECRET");
    await loginMfa(page, "admin-mfa-sessions@e2e.local", TOTP_SECRET);
    const csrf = await getCsrf(page);
    const bad = `slug;nome;sku;preco;category_slug\nok-e2e-${Date.now()};OK;SKU-E2EOK-${Date.now()};10;${CAT}\nbad-e2e;Bad;SKU-E2EBAD;abc;${CAT}\n`;
    const prev = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file: bad, filename: "b.csv" } });
    expect(prev.status()).toBe(200);
    const pj = await prev.json();
    expect(pj.invalid).toBeGreaterThan(0);
    // apply não deve gravar nada com inválidos
    const app = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: bad, checksum: pj.checksum } });
    const aj = await app.json();
    expect(aj.created).toBe(0);
    expect(aj.updated).toBe(0);

    // fórmula maliciosa neutralizada
    const skuF = `SKU-FRM-E2E-${Date.now()}`;
    const frm = `slug;nome;sku;preco;category_slug\nfrm-e2e-${Date.now()};=HYPERLINK("x");${skuF};10;${CAT}\n`;
    const p2 = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file: frm, filename: "f.csv" } });
    const p2j = await p2.json();
    expect(p2j.warnings.some((w: string) => /neutraliz|fórmula|formula/i.test(w))).toBe(true);
    const a2 = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: frm, checksum: p2j.checksum } });
    expect((await a2.json()).created).toBe(1);

    // checksum alterado => 409
    const c409 = await page.request.post(`${API}/api/admin/catalog/import/apply`, { headers: { "x-csrf-token": csrf }, data: { file: frm + "\n", checksum: p2j.checksum } });
    expect(c409.status()).toBe(409);
  });

  test("usuário sem permissão recebe 403", async ({ page }) => {
    test.skip(!TOTP_AT_IMPORT, "Requer E2E_TOTP_SECRET_AT_IMPORT");
    await loginMfa(page, "operador-atendimento-import@e2e.local", TOTP_AT_IMPORT);
    const csrf = await getCsrf(page);
    const file = `slug;nome;sku;preco;category_slug\nx;x;SKU-NOPERM-${Date.now()};1;${CAT}\n`;
    const res = await page.request.post(`${API}/api/admin/catalog/import/preview`, { headers: { "x-csrf-token": csrf }, data: { file, filename: "x.csv" } });
    expect(res.status()).toBe(403);
  });
});
