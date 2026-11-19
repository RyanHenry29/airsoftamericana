// language: TS, file: apps/api/src/db/seed-target.test.ts, target: vitest
import { describe, it, expect } from "vitest";
import {
  assertSeedTargetAllowed,
  databaseHost,
  isLocalDatabaseHost,
  SeedTargetError,
} from "./seed-target.js";

describe("guarda de alvo dos seeds", () => {
  it("recusa seed em produção, mesmo com banco local", () => {
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "production",
        databaseUrl: "postgres://user:pass@localhost:5432/aa",
      }),
    ).toThrow(SeedTargetError);
  });

  it("recusa seed em produção mesmo com opt-in de banco remoto", () => {
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "production",
        databaseUrl: "postgres://user:pass@db.exemplo.supabase.co:5432/postgres",
        allowRemote: true,
      }),
    ).toThrow(/produção/i);
  });

  it("aceita PGlite (sem DATABASE_URL) em dev e test", () => {
    expect(() =>
      assertSeedTargetAllowed({ nodeEnv: "development", databaseUrl: "" }),
    ).not.toThrow();
    expect(() =>
      assertSeedTargetAllowed({ nodeEnv: "test", databaseUrl: "" }),
    ).not.toThrow();
  });

  it("aceita Postgres local de desenvolvimento", () => {
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "development",
        databaseUrl: "postgres://user:pass@localhost:5432/aa_dev",
      }),
    ).not.toThrow();
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "development",
        databaseUrl: "postgres://user:pass@127.0.0.1:5432/aa_dev",
      }),
    ).not.toThrow();
  });

  it("recusa banco remoto sem opt-in explícito", () => {
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "development",
        databaseUrl: "postgres://user:pass@db.exemplo.supabase.co:5432/postgres",
      }),
    ).toThrow(/SEED_ALLOW_REMOTE=1/);
  });

  it("aceita banco remoto com opt-in explícito (operação manual identificada)", () => {
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "development",
        databaseUrl: "postgres://user:pass@db.exemplo.supabase.co:5432/postgres",
        allowRemote: true,
      }),
    ).not.toThrow();
  });

  it("seed de E2E recusa qualquer DATABASE_URL (PGlite exclusivo)", () => {
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "test",
        databaseUrl: "postgres://user:pass@localhost:5432/aa_dev",
        requirePglite: true,
      }),
    ).toThrow(/PGlite/i);
  });

  it("seed de E2E aceita PGlite dedicado", () => {
    expect(() =>
      assertSeedTargetAllowed({
        nodeEnv: "test",
        databaseUrl: "",
        requirePglite: true,
      }),
    ).not.toThrow();
  });

  it("extrai host da connection string", () => {
    expect(databaseHost("postgres://u:p@db.exemplo.supabase.co:5432/postgres")).toBe(
      "db.exemplo.supabase.co",
    );
    expect(databaseHost("")).toBeNull();
    expect(isLocalDatabaseHost("localhost")).toBe(true);
    expect(isLocalDatabaseHost("db.exemplo.supabase.co")).toBe(false);
    expect(isLocalDatabaseHost(null)).toBe(true);
  });
});
