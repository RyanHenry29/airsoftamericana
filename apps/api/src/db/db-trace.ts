// language: TS, file: apps/api/src/db/db-trace.ts, target: Node 22 + Fastify
/**
 * Instrumentação por requisição do caminho de banco.
 *
 * Motivo: o log da Vercel é amostrado — em janelas de saturação o contador de
 * retries voltou 0 mesmo com a curva de latência provando que houve espera.
 * Contagem de log não serve como prova. Esta trilha acumula os números no
 * próprio processo, por requisição, e os devolve na resposta (opt-in pelo
 * cabeçalho `x-db-trace`), de onde o cliente lê sem depender de amostragem.
 *
 * Separa o que o relatório da Opção B não conseguiu separar:
 *   - `acq`  tempo esperando uma conexão do pool (fila local / estabelecimento);
 *   - `sql`  tempo de execução do statement;
 *   - `att`  tentativas da operação;
 *   - `acqto` timeouts de fila do pg-pool;
 *   - `emax`  recusas de admissão do pooler (EMAXCONN / EMAXCONNSESSION);
 *   - `est`   falhas de estabelecimento de conexão;
 *   - `bstop` tentativas canceladas por falta de orçamento.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type DbTrace = {
  /** Tempo total gasto nas consultas desta requisição. */
  queryMs: number;
  /** Parte do total gasta esperando conexão do pool. */
  acquireMs: number;
  /**
   * Tentativas somadas nas duas camadas instrumentadas: aquisição (`connect`)
   * e execução (`query`). Uma consulta saudável registra 2 — 1 de cada. O sinal
   * de repetição é `retries`, não `attempts`.
   */
  attempts: number;
  /** Retries efetivamente executados. */
  retries: number;
  /** `pg-pool`: fila de aquisição estourou `connectionTimeoutMillis`. */
  acquireTimeouts: number;
  /** Pooler recusou o cliente (EMAXCONN / EMAXCONNSESSION). */
  admissionErrors: number;
  /** Conexão não chegou a se estabelecer (ECONNREFUSED, ...). */
  establishmentErrors: number;
  /** Tentativas descartadas porque o orçamento acabaria antes da reserva. */
  budgetStops: number;
  /** Motivo textual de cada retry, na ordem. */
  reasons: string[];
};

const storage = new AsyncLocalStorage<DbTrace>();

export function newTrace(): DbTrace {
  return {
    queryMs: 0,
    acquireMs: 0,
    attempts: 0,
    retries: 0,
    acquireTimeouts: 0,
    admissionErrors: 0,
    establishmentErrors: 0,
    budgetStops: 0,
    reasons: [],
  };
}

export function runWithTrace<T>(trace: DbTrace, fn: () => T): T {
  return storage.run(trace, fn);
}

export function currentTrace(): DbTrace | undefined {
  return storage.getStore();
}

export function noteAttempt(): void {
  const t = storage.getStore();
  if (t) t.attempts += 1;
}

export function noteAcquire(ms: number): void {
  const t = storage.getStore();
  if (t) t.acquireMs += ms;
}

export function noteQuery(ms: number): void {
  const t = storage.getStore();
  if (t) t.queryMs += ms;
}

export function noteClassifier(kind: "acquireTimeout" | "admission" | "establishment"): void {
  const t = storage.getStore();
  if (!t) return;
  if (kind === "acquireTimeout") t.acquireTimeouts += 1;
  else if (kind === "admission") t.admissionErrors += 1;
  else t.establishmentErrors += 1;
}

export function noteRetry(reason: string): void {
  const t = storage.getStore();
  if (!t) return;
  t.retries += 1;
  if (t.reasons.length < 8) t.reasons.push(reason);
}

export function noteBudgetStop(): void {
  const t = storage.getStore();
  if (t) t.budgetStops += 1;
}

/**
 * Cabeçalho compacto e parseável. `acq` e `sql` são o que o relatório anterior
 * não tinha: sem eles, "timeout de aquisição" e "consulta lenta" eram a mesma
 * categoria de falha.
 */
export function traceHeader(trace: DbTrace): string {
  const sql = Math.max(0, Math.round(trace.queryMs - trace.acquireMs));
  return [
    `total=${Math.round(trace.queryMs)}`,
    `acq=${Math.round(trace.acquireMs)}`,
    `sql=${sql}`,
    `att=${trace.attempts}`,
    `retry=${trace.retries}`,
    `acqto=${trace.acquireTimeouts}`,
    `emax=${trace.admissionErrors}`,
    `est=${trace.establishmentErrors}`,
    `bstop=${trace.budgetStops}`,
  ].join(";");
}

/** Versão Server-Timing (padrão do navegador) do mesmo dado. */
export function traceServerTiming(trace: DbTrace): string {
  const sql = Math.max(0, Math.round(trace.queryMs - trace.acquireMs));
  return `db;dur=${Math.round(trace.queryMs)};desc="acq=${Math.round(trace.acquireMs)},sql=${sql},att=${trace.attempts},retry=${trace.retries}"`;
}

/** Forma mínima da resposta HTTP usada aqui (ServerResponse satisfaz). */
type TraceResponse = {
  headersSent: boolean;
  setHeader(name: string, value: string): unknown;
  writeHead: (...args: any[]) => any;
};

/**
 * Abre a trilha da requisição e anexa o resultado à resposta no instante em que
 * os cabeçalhos são escritos.
 *
 * Por que no `writeHead` e não num hook de framework: o entrypoint da API tem
 * dois caminhos — o handler cru (`/api/store/...`) e a delegação para o Fastify
 * (`/api/admin`, `/api/store/blog`). Instrumentar só o Fastify deixaria de fora
 * exatamente a rota medida nas rajadas. O patch do `writeHead` cobre os dois, e
 * cobre também a resposta de erro: o 500 passa pelo mesmo caminho de escrita.
 *
 * Opt-in pelo cabeçalho `x-db-trace`: quem mede pede, o cliente comum não
 * recebe header extra. A trilha é coletada mesmo sem o pedido — custo de um
 * punhado de contadores — para não depender de o cliente lembrar do cabeçalho.
 */
export function withDbTrace<T>(res: TraceResponse, wantsTrace: boolean, fn: () => Promise<T>): Promise<T> {
  const trace = newTrace();
  if (wantsTrace) {
    const originalWriteHead = res.writeHead;
    res.writeHead = function patchedWriteHead(this: unknown, ...args: any[]) {
      if (!res.headersSent) {
        res.setHeader("x-db-trace", traceHeader(trace));
        res.setHeader("Server-Timing", traceServerTiming(trace));
      }
      return originalWriteHead.apply(res, args as [any]);
    };
  }
  return runWithTrace(trace, fn);
}
