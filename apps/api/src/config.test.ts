// language: TS, file: apps/api/src/config.test.ts, target: vitest
import { describe, it, expect } from "vitest";
import { assertProductionEnv, DefaultJwtSecret } from "./config.js";

const COMPLETE: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  JWT_SECRET: "a".repeat(64),
  GATEWAY_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
  DATABASE_URL: "postgres://user:pass@db:5432/airsoft",
  STORE_URL: "https://airsoftamericana.com.br",
  ADMIN_URL: "https://admin.airsoftamericana.com.br",
};

function problemas(env: Partial<NodeJS.ProcessEnv>): string[] {
  return assertProductionEnv({ ...COMPLETE, ...env } as NodeJS.ProcessEnv).map((p) => p.variable);
}

describe("arranque em produção", () => {
  it("aceita um ambiente completo", () => {
    expect(assertProductionEnv(COMPLETE)).toEqual([]);
  });

  it("recusa JWT_SECRET ausente", () => {
    const found = assertProductionEnv({ ...COMPLETE, JWT_SECRET: "" } as NodeJS.ProcessEnv);
    expect(found.map((p) => p.variable)).toContain("JWT_SECRET");
    expect(found.find((p) => p.variable === "JWT_SECRET")?.message).toMatch(/ausente/i);
  });

  it("recusa JWT_SECRET no valor padrão de desenvolvimento", () => {
    const found = assertProductionEnv({ ...COMPLETE, JWT_SECRET: DefaultJwtSecret } as NodeJS.ProcessEnv);
    expect(found.map((p) => p.variable)).toContain("JWT_SECRET");
    expect(found.find((p) => p.variable === "JWT_SECRET")?.message).toMatch(/padrão/i);
  });

  it("recusa chave de criptografia ausente", () => {
    const found = assertProductionEnv({ ...COMPLETE, GATEWAY_SECRETS_KEY: "" } as NodeJS.ProcessEnv);
    expect(found.map((p) => p.variable)).toContain("GATEWAY_SECRETS_KEY");
    expect(found.find((p) => p.variable === "GATEWAY_SECRETS_KEY")?.message).toMatch(/ausente/i);
  });

  it("recusa chave de criptografia com tamanho errado", () => {
    const found = assertProductionEnv({
      ...COMPLETE,
      GATEWAY_SECRETS_KEY: Buffer.alloc(16, 3).toString("base64"),
    } as NodeJS.ProcessEnv);
    expect(found.map((p) => p.variable)).toContain("GATEWAY_SECRETS_KEY");
    expect(found.find((p) => p.variable === "GATEWAY_SECRETS_KEY")?.message).toMatch(/32 bytes/i);
  });

  it("recusa banco de dados ausente (PGlite é só dev/teste)", () => {
    expect(problemas({ DATABASE_URL: "" })).toContain("DATABASE_URL");
  });

  it("recusa URL pública em localhost ou sem HTTPS", () => {
    expect(problemas({ STORE_URL: "http://localhost:3000" })).toContain("STORE_URL");
    expect(problemas({ ADMIN_URL: "http://admin.airsoftamericana.com.br" })).toContain("ADMIN_URL");
  });

  it("relata todos os problemas de uma vez", () => {
    const found = assertProductionEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    const variaveis = found.map((p) => p.variable);
    expect(variaveis).toContain("JWT_SECRET");
    expect(variaveis).toContain("GATEWAY_SECRETS_KEY");
    expect(variaveis).toContain("DATABASE_URL");
    expect(variaveis).toContain("STORE_URL");
    expect(variaveis).toContain("ADMIN_URL");
  });
});
