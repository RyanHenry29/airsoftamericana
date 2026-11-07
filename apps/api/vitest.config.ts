import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
