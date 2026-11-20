// language: TS, file: apps/api/src/config.test.ts, target: vitest
import { describe, it, expect } from "vitest";
import { assertProductionEnv, DefaultJwtSecret, runtimeDatabaseUrl } from "./config.js";

const COMPLETE: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  JWT_SECRET: "a".repeat(64),
  GATEWAY_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
  DATABASE_URL: "postgres://user:pass@db:5432/airsoft",
  DATABASE_URL_RUNTIME: "postgres://user:pass@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
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

  it("B.1: em produção, CSRF_ENFORCE=false recusa subir", () => {
    expect(problemas({ CSRF_ENFORCE: "false" })).toContain("CSRF_ENFORCE");
    expect(problemas({ CSRF_ENFORCE: "true" })).not.toContain("CSRF_ENFORCE");
  });
});

describe("DATABASE_URL_RUNTIME (pooler do runtime serverless)", () => {
  it("tem precedência sobre DATABASE_URL", () => {
    expect(
      runtimeDatabaseUrl({
        DATABASE_URL: "postgres://u:p@pooler:5432/postgres",
        DATABASE_URL_RUNTIME: "postgres://u:p@pooler:6543/postgres",
      }),
    ).toBe("postgres://u:p@pooler:6543/postgres");
  });

  it("cai em DATABASE_URL quando não há URL de runtime", () => {
    expect(runtimeDatabaseUrl({ DATABASE_URL: "postgres://u:p@pooler:5432/postgres" })).toBe(
      "postgres://u:p@pooler:5432/postgres",
    );
    expect(runtimeDatabaseUrl({})).toBe("");
  });

  it("recusa URL de runtime que não é Postgres", () => {
    expect(problemas({ DATABASE_URL_RUNTIME: "https://banco.example.com" })).toContain("DATABASE_URL_RUNTIME");
    expect(problemas({ DATABASE_URL_RUNTIME: "postgres://u:p@pooler:6543/postgres" })).not.toContain(
      "DATABASE_URL_RUNTIME",
    );
  });

  it("recusa arrancar em produção sem DATABASE_URL_RUNTIME (fallback silencioso pro session mode)", () => {
    const found = assertProductionEnv({ ...COMPLETE, DATABASE_URL_RUNTIME: "" } as NodeJS.ProcessEnv);
    expect(found.map((p) => p.variable)).toContain("DATABASE_URL_RUNTIME");
    expect(found.find((p) => p.variable === "DATABASE_URL_RUNTIME")?.message).toMatch(/transaction mode/i);
  });

  it("recusa DATABASE_URL_RUNTIME apontada para o session mode do pooler", () => {
    const found = assertProductionEnv({
      ...COMPLETE,
      DATABASE_URL_RUNTIME: "postgres://u:p@aws-1-ca-central-1.pooler.supabase.com:5432/postgres",
    } as NodeJS.ProcessEnv);
    expect(found.map((p) => p.variable)).toContain("DATABASE_URL_RUNTIME");
    expect(found.find((p) => p.variable === "DATABASE_URL_RUNTIME")?.message).toMatch(/6543/);
  });

  it("aceita DATABASE_URL_RUNTIME em transaction mode e conexão direta", () => {
    expect(problemas({})).not.toContain("DATABASE_URL_RUNTIME");
    expect(
      problemas({ DATABASE_URL_RUNTIME: "postgres://u:p@db.abc.supabase.co:5432/postgres" }),
    ).not.toContain("DATABASE_URL_RUNTIME");
  });

  it("runtimeDatabaseUrl recusa o fallback em produção", () => {
    expect(() =>
      runtimeDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: "postgres://u:p@pooler:5432/postgres" }),
    ).toThrow(/DATABASE_URL_RUNTIME/);
    expect(
      runtimeDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://u:p@pooler:5432/postgres",
        DATABASE_URL_RUNTIME: "postgres://u:p@pooler:6543/postgres",
      }),
    ).toBe("postgres://u:p@pooler:6543/postgres");
  });

  it("runtimeDatabaseUrl mantém o fallback fora de produção", () => {
    expect(
      runtimeDatabaseUrl({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://u:p@aws-1-ca-central-1.pooler.supabase.com:5432/postgres",
      }),
    ).toBe("postgres://u:p@aws-1-ca-central-1.pooler.supabase.com:5432/postgres");
  });
});
