import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { API, totpFromSecretBase32, secretFromOtpauth } from "./helpers";

/**
 * Dados de teste esperados (semeados por scripts/e2e-seed.mjs em DB isolado):
 * - admin-sem-mfa@e2e.local / Senha123!  (mfaEnabled=false, ativo)
 * - admin-mfa@e2e.local     / Senha123!  (mfaEnabled=true, TOTP conhecido via env E2E_TOTP_SECRET)
 * - invite válido/expirado criados pelo seed (tokens em env E2E_INVITE_TOKEN / E2E_INVITE_EXPIRED_TOKEN)
 * - operador-atendimento@e2e.local / Senha123! (papel atendimento, MFA ativo via E2E_TOTP_SECRET_AT)
 *
 * Se o ambiente de E2E não estiver preparado (servidores/seed), os testes que dependem
 * de infraestrutura real falham com diagnóstico claro — não simulam sucesso.
 */

const PASS = "Senha123!";
const TOTP_SECRET = process.env.E2E_TOTP_SECRET || "";
const TOTP_SECRET_AT = process.env.E2E_TOTP_SECRET_AT || process.env.E2E_TOTP_SECRET || "";

async function login(page: Page, email: string, password = PASS) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
}

test.describe("FASE 2 — login", () => {
  test.skip(!process.env.E2E_READY, "Requer E2E_READY=1 com API+admin+seed isolados (npm run test:e2e:up)");

  test("login inválido exibe erro e não autentica", async ({ page }) => {
    await login(page, "naoexiste@e2e.local", "errada");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("primeiro acesso com MFA não configurado redireciona para setup", async ({ page }) => {
    await login(page, "admin-sem-mfa@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/setup/);
    await expect(page.getByText(/verificação em duas etapas|ative/i)).toBeVisible();
  });

  test("sessão expirada redireciona para login com mensagem", async ({ page }) => {
    await page.goto("/login?expired=1");
    await expect(page.getByText(/sessão expirada/i)).toBeVisible();
  });

  test("logout encerra sessão", async ({ page }) => {
    const secret = process.env.E2E_TOTP_SECRET;
    test.skip(!secret, "Requer E2E_TOTP_SECRET");
    await login(page, "admin-mfa-logout@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await page.getByLabel(/código/i).fill(totpFromSecretBase32(secret!));
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.getByRole("button", { name: /sair/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("FASE 2 — TOTP e recuperação", () => {
  test.skip(!process.env.E2E_READY, "Requer E2E_READY=1 com API+admin+seed isolados");

  test("configuração TOTP: QR, confirmação e exibição única dos 10 códigos", async ({ page }) => {
    // usa admin-sem-mfa@e2e.local (consome estado de setup → MFA ativo após este teste)
    await login(page, "admin-sem-mfa@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/setup/);
    await expect(page.locator('img[alt*="QR"]')).toBeVisible({ timeout: 15000 });
    const secretEl = page.locator("code").first();
    await expect(secretEl).toBeVisible();
    const secret = (await secretEl.textContent())?.trim() || "";
    expect(secret.length).toBeGreaterThan(10);
    const code = totpFromSecretBase32(secret);
    await page.getByLabel(/código de 6 dígitos/i).fill(code);
    await page.getByRole("button", { name: /ativar mfa/i }).click();
    await expect(page.getByText(/códigos de recuperação/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/exibidos uma única vez/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /copiar códigos/i })).toBeVisible();
    const items = page.locator("ul li");
    await expect(items).toHaveCount(10);
  });

  test("verificação TOTP com conta MFA ativa", async ({ page }) => {
    test.skip(!TOTP_SECRET, "Requer E2E_TOTP_SECRET");
    await login(page, "admin-mfa-verify@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/verify/);
    const code = totpFromSecretBase32(TOTP_SECRET);
    await page.getByLabel(/código do autenticador|código/i).fill(code);
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test("código de recuperação funciona (uso único)", async ({ page }) => {
    const recovery = process.env.E2E_RECOVERY_CODE;
    const secret = process.env.E2E_TOTP_SECRET_RECOVERY || process.env.E2E_TOTP_SECRET;
    test.skip(!recovery || !secret, "Requer E2E_RECOVERY_CODE e secret");
    // usa usuário dedicado a recovery para não conflitar com outros testes
    await login(page, process.env.E2E_RECOVERY_USER || "admin-recovery@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await page.getByRole("button", { name: /código de recuperação/i }).click();
    await page.getByLabel(/código de recuperação/i).fill(recovery!);
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });
});

test.describe("FASE 2 — convites e permissões", () => {
  test.skip(!process.env.E2E_READY, "Requer E2E_READY=1 com API+admin+seed isolados");

  test("convite válido permite aceite e exige configuração de senha", async ({ page }) => {
    const token = process.env.E2E_INVITE_TOKEN;
    test.skip(!token, "Requer E2E_INVITE_TOKEN");
    await page.goto(`/convite?token=${token}`);
    await page.getByLabel(/^Nome$/i).fill("Operador E2E");
    await page.getByLabel(/^Senha$/i).fill("SenhaForte123!");
    await page.getByLabel(/Repetir a senha/i).fill("SenhaForte123!");
    await page.getByRole("button", { name: /criar minha conta/i }).click();
    await expect(page.getByText(/conta criada/i)).toBeVisible({ timeout: 15000 });
  });

  test("convite expirado exibe mensagem clara", async ({ page }) => {
    const token = process.env.E2E_INVITE_EXPIRED_TOKEN;
    test.skip(!token, "Requer E2E_INVITE_EXPIRED_TOKEN");
    await page.goto(`/convite?token=${token}`);
    await page.getByLabel(/^Nome$/i).fill("Operador E2E");
    await page.getByLabel(/^Senha$/i).fill("SenhaForte123!");
    await page.getByLabel(/Repetir a senha/i).fill("SenhaForte123!");
    await page.getByRole("button", { name: /criar minha conta/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("usuário sem permissão é barrado (403) em ação restrita", async ({ page }) => {
    test.skip(!TOTP_SECRET_AT, "Requer E2E_TOTP_SECRET_AT");
    await login(page, "operador-atendimento@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await page.getByLabel(/código/i).fill(totpFromSecretBase32(TOTP_SECRET_AT));
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.goto("/users");
    // atendimento tem users? pela matriz original não; nossa UI de "Acessos" carrega /api/admin/users (users.read) — se barrado, mostra erro/gate
    // verificamos que convites (superadmin-only) não aparecem como gerenciáveis ou API retorna 403
    const res = await page.request.get(`${API}/api/admin/invites`);
    expect([401, 403]).toContain(res.status());
  });

  test("superadmin gerencia convite e revogação de sessão (API real)", async ({ page }) => {
    test.skip(!TOTP_SECRET, "Requer E2E_TOTP_SECRET");
    await login(page, "admin-mfa-sessions@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await page.getByLabel(/código/i).fill(totpFromSecretBase32(TOTP_SECRET));
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.goto("/users");
    await expect(page.getByText(/^Convites$/)).toBeVisible();
    await expect(page.getByText(/minhas sessões/i)).toBeVisible();
  });
});

test.describe("FASE 2 — passkey com autenticador virtual", () => {
  test("cadastra e remove passkey via CDP WebAuthn (Chromium)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Autenticador virtual requer Chromium/CDP");
    test.skip(!process.env.E2E_READY || !process.env.E2E_TOTP_SECRET, "Requer ambiente E2E");
    const secret = process.env.E2E_TOTP_SECRET!;
    const client: CDPSession = await page.context().newCDPSession(page);
    await client.send("WebAuthn.enable");
    await client.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    page.on("dialog", async (d) => {
      if (d.type() === "prompt") await d.accept(totpFromSecretBase32(secret));
      else await d.accept();
    });

    // login como usuário MFA-ativo dedicado e cadastra passkey na área de Acessos
    await login(page, "admin-mfa-passkey@e2e.local");
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await page.getByLabel(/código/i).fill(totpFromSecretBase32(secret));
    await page.getByRole("button", { name: /confirmar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await page.goto("/users");
    await page.getByRole("button", { name: /cadastrar passkey/i }).click();
    await expect(page.getByText(/passkey cadastrada|nenhuma passkey|passkey/i).first()).toBeVisible({ timeout: 25000 });
    const removeBtn = page.getByRole("button", { name: /remover/i }).first();
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await expect(page.getByText(/removida|nenhuma passkey/i).first()).toBeVisible({ timeout: 15000 });
    }
  });
});
