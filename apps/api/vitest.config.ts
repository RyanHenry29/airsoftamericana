import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // PGlite usa diretório exclusivo (apps/api/data-test) — execução 100%
    // sequencial, 1 worker/processo, sem isolamento por arquivo (singleton DB).
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
    sequence: { concurrent: false },
    pool: "forks",
    poolOptions: { forks: { singleFork: true, minForks: 1, maxForks: 1 } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
