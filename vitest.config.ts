import { defineConfig } from "vitest/config";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// Config raiz segura: NUNCA aponta para o banco de desenvolvimento.
// Roda testes puros/domínio (packages, vitest/). Os testes da API (DB/PGlite)
// rodam via workspace @airsoft/api com apps/api/vitest.config.ts.
const testDir = process.env.PGLITE_DIR || path.join(mkdtempSync(path.join(tmpdir(), "aa-vitest-root-")), "db");
process.env.DATABASE_URL = "";
process.env.PGLITE_DIR = testDir;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-do-not-use-in-production";
process.env.GATEWAY_SECRETS_KEY = "";
process.env.API_PORT = "4323";
process.env.API_HOST = "127.0.0.1";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "vitest/**/*.test.ts"],
    exclude: [
      "node_modules",
      ".git",
      ".next",
      "dist",
      "docs/legacy-zero-dep/**",
      "mirror/**",
      "apps/api/src/**",
      "apps/**/data/**",
      "apps/**/data-test/**",
      "vitest/data-test-root/**",
    ],
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    pool: "forks",
    forks: { singleFork: true, minForks: 1, maxForks: 1 },
    globals: false,
  },
});
