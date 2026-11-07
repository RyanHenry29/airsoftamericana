import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["vitest/**/*.test.ts", "apps/api/src/**/*.test.ts"],
    exclude: ["node_modules", ".git"],
    globals: true,
    // Esta config também roda os testes da API (apps/api/src/**/*.test.ts).
    // O setup fixa PGLITE_DIR num diretório exclusivo: sem ele, a suíte
    // abria o banco de desenvolvimento e derrubava as tabelas.
    setupFiles: ["./vitest/setup.mts"],
    typecheck: {
      enabled: true,
    },
  },
});