import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // O PGlite de teste abre o diretório com trava exclusiva: dois arquivos
    // de teste em paralelo brigam pelo mesmo cluster. Os arquivos rodam em
    // sequência, cada um abrindo e fechando o próprio banco.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
