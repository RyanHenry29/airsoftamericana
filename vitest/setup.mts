// Setup da suíte da raiz (vitest/config.mts).
//
// Esta config inclui apps/api/src/**/*.test.ts, mas não usa o setup do
// workspace da API. Sem PGLITE_DIR explícito, os testes abriam o MESMO
// diretório do dev (dependia do cwd) e derrubavam as tabelas do banco de
// trabalho — foi o que corrompeu o cluster do PGlite.
//
// Caminho absoluto, exclusivo desta suíte: nada aqui encosta no banco de
// desenvolvimento.
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
