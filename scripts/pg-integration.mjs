// language: JS (ESM), file: scripts/pg-integration.mjs
// Integração com PostgreSQL REAL: sobe embedded-postgres na porta 55432,
// aponta DATABASE_URL para ele e roda as suítes de integridade de pagamentos
// e checkout (FOR UPDATE, transações e corridas em Postgres de verdade).
// Nunca toca produção — banco efêmero em diretório temporário.
import EmbeddedPostgres from "embedded-postgres";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 55432;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "airsoft-pg-"));

let pg;
try {
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "integration",
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  console.log(`[pg-integration] PostgreSQL real ativo na porta ${PORT}`);

  // Evidência de versão EFETIVA do servidor (exigência do revisor):
  // a versão do pacote embedded-postgres não comprova o binário executado.
  // `pg` é dependência de apps/api — resolve a partir daí.
  const { createRequire } = await import("node:module");
  const apiRequire = createRequire(path.join(process.cwd(), "apps", "api", "package.json"));
  const Client = apiRequire("pg").Client;
  const versionClient = new Client({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: "integration",
    database: "postgres",
  });
  await versionClient.connect();
  const { rows } = await versionClient.query("SHOW server_version");
  console.log(`[pg-integration] SHOW server_version => ${rows[0].server_version}`);
  await versionClient.end();

  const env = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: `postgresql://postgres:integration@localhost:${PORT}/postgres`,
    JWT_SECRET: "integration-secret",
    GATEWAY_SECRETS_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };

  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "src/services/payments-integrity.test.ts",
      "src/services/checkout.test.ts",
      "src/services/orders.test.ts",
      "src/routes/price-stock-transactional.test.ts",
    ],
    {
      cwd: path.join(process.cwd(), "apps", "api"),
      env,
      stdio: "inherit",
      shell: true,
      timeout: 15 * 60 * 1000,
    },
  );
  console.log(`[pg-integration] vitest exit=${result.status}`);
  process.exitCode = result.status ?? 1;
} finally {
  try {
    await pg?.stop();
  } catch {
    // banco efêmero — falha ao parar não mascara o resultado dos testes
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows pode manter handle por alguns instantes
  }
}
