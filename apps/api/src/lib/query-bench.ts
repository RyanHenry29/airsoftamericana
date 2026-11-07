// language: TS, file: apps/api/src/lib/query-bench.ts, target: Node (test/benchmark only)
// Contador de queries SQL para benchmark/teste — logger instalado em NODE_ENV=test;
// contagem ativa apenas entre benchStart()/benchReset(). Nunca registra SQL, params, PII, tokens ou segredos.

let enabled = false;
let count = 0;

export function benchActive(): boolean {
  return enabled;
}

export function benchStart(): void {
  enabled = process.env.NODE_ENV === "test";
  count = 0;
}

export function benchReset(): void {
  count = 0;
}

export function benchStop(): void {
  enabled = false;
  count = 0;
}

export function benchTick(): void {
  if (enabled) count += 1;
}

export function benchCount(): number {
  return count;
}

export const benchLogger = {
  logQuery(_query: string, _params: unknown[]): void {
    benchTick();
  },
};
