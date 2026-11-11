import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // PGlite usa diretório exclusivo (apps/api/data-test) — execução 100%
    // sequencial, 1 worker/processo, COM isolamento por arquivo para evitar
    // conflitos de estado do PGlite entre arquivos de teste.
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
    sequence: { concurrent: false },
    pool: "threads",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
