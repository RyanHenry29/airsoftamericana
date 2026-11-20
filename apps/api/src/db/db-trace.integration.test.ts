// language: TS, file: apps/api/src/db/db-trace.integration.test.ts, target: vitest + Postgres real
// Prova que a trilha enche através do pool REAL (patch de `pool.query` →
// `pool.connect` interno), não apenas no teste com resposta falsa.
// Roda só quando PG_INTEGRATION_URL aponta para Postgres
// (scripts/pg-integration.mjs define a variável; o setup da suíte apaga
// DATABASE_URL para forçar PGlite nos demais arquivos).
import { describe, expect, it } from "vitest";
import { createResilientPool } from "./db-retry.js";
import { newTrace, runWithTrace, traceHeader } from "./db-trace.js";

const pgUrl = process.env.PG_INTEGRATION_URL ?? "";
const hasPg = pgUrl.startsWith("postgres://") || pgUrl.startsWith("postgresql://");

describe.skipIf(!hasPg)("trilha com Postgres real", () => {
  it("mede aquisição e execução de uma consulta que passou pelo pool", async () => {
    const pool = createResilientPool({
      connectionString: pgUrl,
      max: 1,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
    });

    const trace = newTrace();
    await runWithTrace(trace, async () => {
      await pool.query("select 1 as one");
    });

    // Duas camadas instrumentadas para uma consulta que passou pelo pool:
    // a aquisição (patch de `connect`, chamado por dentro de `pool.query`) e a
    // execução. Nenhuma delas repetiu.
    expect(trace.attempts).toBe(2);
    expect(trace.retries).toBe(0);
    // Aquisição existiu (mesmo que o pool já tivesse cliente ocioso, o
    // caminho instrumentado foi percorrido) e a consulta rodou dentro do
    // orçamento.
    expect(trace.acquireMs).toBeGreaterThanOrEqual(0);
    expect(trace.queryMs).toBeGreaterThanOrEqual(trace.acquireMs);
    expect(traceHeader(trace)).toMatch(/^total=\d+;acq=\d+;sql=\d+;att=2;retry=0;acqto=0;emax=0;est=0;bstop=0$/);

    await pool.end();
  });
});
