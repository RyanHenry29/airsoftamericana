// Setup da suíte da API (apps/api/vitest.config.ts).
// PGLITE_DIR é obrigatório: sem ele a suíte abre o MESMO diretório do dev
// (apps/api/data) e corrompe o banco de trabalho.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

process.env.DATABASE_URL = "";
process.env.PGLITE_DIR = path.join(here, "data-test");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-do-not-use-in-production";
process.env.GATEWAY_SECRETS_KEY = "";
process.env.API_PORT = "4321";
process.env.API_HOST = "127.0.0.1";

afterAll(async () => {
  try {
    const mod = await import("./src/db/index.js");
    if (typeof mod.closeDb === "function") await mod.closeDb();
  } catch {
    // ignora: evita mascarar falhas reais de teste
  }
});
