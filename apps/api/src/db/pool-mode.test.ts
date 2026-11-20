// language: TS, file: apps/api/src/db/pool-mode.test.ts, target: vitest
// Modo do pooler, dimensionamento do pool e guard de lock de sessão.
import { describe, expect, it } from "vitest";
import { assertSessionScopeSafe, classifyPooler, poolSizing } from "./pool-mode.js";

describe("classifyPooler", () => {
  it("reconhece o pooler do Supabase em session mode (porta 5432)", () => {
    expect(classifyPooler("postgresql://airsoft_app.abc:senha@aws-1-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require")).toBe(
      "session",
    );
  });

  it("reconhece o pooler em transaction mode (porta 6543)", () => {
    expect(classifyPooler("postgresql://airsoft_app.abc:senha@aws-1-ca-central-1.pooler.supabase.com:6543/postgres?sslmode=require")).toBe(
      "transaction",
    );
  });

  it("trata conexão direta como direct", () => {
    expect(classifyPooler("postgresql://airsoft_app:senha@db.abc.supabase.co:5432/postgres")).toBe("direct");
    expect(classifyPooler("postgresql://postgres:integration@localhost:55432/postgres")).toBe("direct");
  });

  it("não quebra com URL inválida", () => {
    expect(classifyPooler("nao-e-url")).toBe("direct");
  });
});

describe("poolSizing", () => {
  it("uma conexão por instância nos modos com pooler (limite global do pooler)", () => {
    expect(poolSizing("transaction").max).toBe(1);
    expect(poolSizing("session").max).toBe(1);
  });

  it("mantém 5 conexões em conexão direta (sem trava de pooler)", () => {
    expect(poolSizing("direct").max).toBe(5);
  });

  it("sempre limita a espera por conexão", () => {
    for (const mode of ["transaction", "session", "direct"] as const) {
      expect(poolSizing(mode).connectionTimeoutMillis).toBeGreaterThan(0);
    }
  });
});

describe("assertSessionScopeSafe", () => {
  it("recusa transaction mode para operações com lock de sessão", () => {
    expect(() =>
      assertSessionScopeSafe(
        "postgresql://airsoft_ddl:senha@aws-1-ca-central-1.pooler.supabase.com:6543/postgres",
        "db:bootstrap (bootstrap de produção)",
      ),
    ).toThrow(/lock de SESSÃO/);
  });

  it("aceita session mode e conexão direta", () => {
    expect(() =>
      assertSessionScopeSafe(
        "postgresql://airsoft_ddl:senha@aws-1-ca-central-1.pooler.supabase.com:5432/postgres",
        "db:bootstrap (bootstrap de produção)",
      ),
    ).not.toThrow();
    expect(() =>
      assertSessionScopeSafe("postgresql://airsoft_ddl:senha@db.abc.supabase.co:5432/postgres", "db:bootstrap"),
    ).not.toThrow();
  });
});
