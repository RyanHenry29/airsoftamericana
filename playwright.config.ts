import { defineConfig, devices } from "@playwright/test";

/**
 * E2E FASE 2 — autenticação administrativa.
 * Requer API (porta 4000, PGLITE_DIR isolado) e Admin (porta 3001) em execução
 * com dados de teste semeados por `node scripts/e2e-seed.mjs`.
 * Execução: `npm run test:e2e` (sobe servidores via webServer quando possível).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_ADMIN_URL || "http://localhost:3001",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
