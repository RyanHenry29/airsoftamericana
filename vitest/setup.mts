// Setup da suíte da raiz (vitest/config.mts -> vitest/**/*.test.ts).
// Os testes aqui são de domínio (sem PGlite direto); definimos env de teste
// seguro mesmo assim, apontando PGLITE_DIR para um diretório exclusivo desta
// suíte, nunca para o banco de desenvolvimento.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

process.env.DATABASE_URL = "";
process.env.PGLITE_DIR = path.join(here, "data-test-root");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-do-not-use-in-production";
process.env.GATEWAY_SECRETS_KEY = "";
process.env.API_PORT = "4322";
process.env.API_HOST = "127.0.0.1";
