// language: TS, file: apps/api/src/lib/error-chain.test.ts, target: vitest
// Cadeia de causas no log: a causa original do driver não pode se perder.
import { describe, expect, it } from "vitest";
import { describeErrorChain } from "./error-chain.js";

describe("describeErrorChain", () => {
  it("desce pela cadeia de causes", () => {
    const erro = new Error("Failed query: select 1");
    (erro as { cause?: unknown }).cause = Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
    });
    expect(describeErrorChain(erro)).toBe(
      "Failed query: select 1 <- 57P01: terminating connection due to administrator command",
    );
  });

  it("trunca a mensagem do drizzle (que carrega o SQL inteiro)", () => {
    const erro = new Error("x".repeat(500));
    const saida = describeErrorChain(erro);
    expect(saida.length).toBeLessThan(320);
    expect(saida.endsWith("…")).toBe(true);
  });

  it("para em valores que não são Error", () => {
    const erro = new Error("fora");
    (erro as { cause?: unknown }).cause = "texto";
    expect(describeErrorChain(erro)).toBe("fora");
  });

  it("aceita erro sem message", () => {
    expect(describeErrorChain("texto puro")).toBe("texto puro");
  });
});
