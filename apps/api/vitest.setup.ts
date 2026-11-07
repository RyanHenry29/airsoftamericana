// Setup da suíte: cada teste gerencia seu próprio banco via migrate/seed no beforeEach.
//
// PGLITE_DIR é obrigatório aqui: sem ele a suíte abre o MESMO diretório do dev
// (apps/api/data) e derruba as tabelas do banco de trabalho — foi o que
// corrompeu o PGlite de desenvolvimento. Caminho absoluto, derivado do próprio
// arquivo, para funcionar tanto no workspace quanto na config da raiz.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

process.env.DATABASE_URL = "";
process.env.PGLITE_DIR = path.join(here, "data-test");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-do-not-use-in-production";
process.env.GATEWAY_SECRETS_KEY = "";
process.env.API_PORT = "4321";
process.env.API_HOST = "127.0.0.1";
