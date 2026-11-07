import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Somente testes de domínio/integração da raiz. Os testes da API rodam no
    // workspace @airsoft/api com o setup/config próprios (evita dupla execução
    // e conflito de diretório PGlite).
    include: ["vitest/**/*.test.ts"],
    exclude: ["node_modules", ".git", "docs/legacy-zero-dep/**", "mirror/**"],
    globals: true,
    setupFiles: ["./vitest/setup.mts"],
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    pool: "forks",
    typecheck: {
      enabled: true,
    },
  },
});
