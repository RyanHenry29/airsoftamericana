import { test, expect, type Page } from "@playwright/test";
import { API, totpFromSecretBase32 } from "./helpers";

const PASS = "Senha123!";
const TOTP_SA = process.env.E2E_TOTP_SECRET_CATALOG || process.env.E2E_TOTP_SECRET_CSV1 || "";
const TOTP_MKT = process.env.E2E_TOTP_SECRET_MARKETING || "";
const TOTP_AT = process.env.E2E_TOTP_SECRET_AT_CATALOG || process.env.E2E_TOTP_SECRET_AT_IMPORT || "";

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

async function firstProductId(page: Page): Promise<string> {
  const list = await page.request.get(`${API}/api/admin/products`);
  expect(list.ok()).toBe(true);
  const lj = await list.json();
  const pid = (lj.items || [])[0]?.id;
  expect(pid).toBeTruthy();
  return pid;
}

test.describe("FASE 3 - Admin catalogo (role-gating custo)", () => {
  test.skip(!process.env.E2E_READY, "Requer E2E_READY=1 com API+admin+seed isolados");

  test("superadmin (autorizado) ve e edita costCents no admin", async ({ page }) => {
    test.skip(!TOTP_SA, "Requer E2E_TOTP_SECRET_CATALOG");
    await loginMfa(page, "admin-mfa-catalog@e2e.local", TOTP_SA);
    const csrf = await getCsrf(page);
    const pid = await firstProductId(page);
    const setCost = await page.request.patch(`${API}/api/admin/products/${pid}`, { headers: { "x-csrf-token": csrf }, data: { costCents: 1234 } });
    expect(setCost.ok()).toBe(true);
    const detail = await page.request.get(`${API}/api/admin/products/${pid}`);
    const d = await detail.json();
    expect(d.product).toHaveProperty("costCents");
    expect(d.product.costCents).toBe(1234);
  });

  test("marketing (products:update, sem permissao de custo) nao recebe costCents e recebe 403 ao editar", async ({ page }) => {
    test.skip(!TOTP_MKT, "Requer E2E_TOTP_SECRET_MARKETING");
    await loginMfa(page, "admin-mfa-marketing@e2e.local", TOTP_MKT);
    const csrf = await getCsrf(page);
    const pid = await firstProductId(page);
    const detail = await page.request.get(`${API}/api/admin/products/${pid}`);
    const d = await detail.json();
    expect(d.product).not.toHaveProperty("costCents");
    expect(d.product).not.toHaveProperty("cost_cents");
    const patchCost = await page.request.patch(`${API}/api/admin/products/${pid}`, { headers: { "x-csrf-token": csrf }, data: { costCents: 9999 } });
    expect(patchCost.status()).toBe(403);
  });

  test("atendimento (leitura produtos) nao recebe costCents no detalhe admin", async ({ page }) => {
    test.skip(!TOTP_AT, "Requer E2E_TOTP_SECRET_AT_CATALOG");
    await loginMfa(page, "operador-atendimento-catalog@e2e.local", TOTP_AT);
    const pid = await firstProductId(page);
    const detail = await page.request.get(`${API}/api/admin/products/${pid}`);
    expect(detail.ok()).toBe(true);
    const d = await detail.json();
    expect(d.product).not.toHaveProperty("costCents");
    expect(d.product).not.toHaveProperty("cost_cents");
  });
});
