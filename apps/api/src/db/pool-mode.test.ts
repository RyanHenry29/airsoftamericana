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

  it("padrão: uma conexão por instância e fila de 10 s (controle medido)", () => {
    // O regime aquecido só fecha 300/300 com a espera LONGA: a fila do pool é
    // o que serializa as invocações concorrentes da mesma instância. Cortar a
    // espera converte fila em erro — medido no experimento B2 (6-12/300).
    expect(poolSizing("transaction")).toMatchObject({
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
    });
    expect(poolSizing("session")).toMatchObject({
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
    });
  });

  it("dimensionamento por variável de ambiente (benchmark de concorrência)", () => {
    const before = { ...process.env };
    try {
      process.env.DB_POOL_MAX = "3";
      process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = "2500";
      process.env.DB_POOL_IDLE_TIMEOUT_MS = "20000";
      expect(poolSizing("transaction")).toMatchObject({
        max: 3,
        connectionTimeoutMillis: 2_500,
        idleTimeoutMillis: 20_000,
      });
      // Valor inválido ou fora da faixa não passa: o fallback é o padrão.
      process.env.DB_POOL_MAX = "lixo";
      expect(poolSizing("transaction").max).toBe(1);
      process.env.DB_POOL_MAX = "999";
      expect(poolSizing("transaction").max).toBe(20);
    } finally {
      process.env = before;
    }
  });

  it("devolve a vaga do pooler quando a conexão fica ociosa", () => {
    for (const mode of ["transaction", "session", "direct"] as const) {
      expect(poolSizing(mode).idleTimeoutMillis).toBeGreaterThan(0);
      expect(poolSizing(mode).idleTimeoutMillis).toBeLessThanOrEqual(30_000);
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
