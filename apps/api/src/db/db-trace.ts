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
import { randomBytes } from "node:crypto";

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
  /** Tempo de execução do statement (SQL), após subtrair a aquisição. */
  sqlMs?: number;
  /** Identidade do processo que atendeu a requisição. */
  inst?: string;
  /** Número máximo de conexões do pool configurado. */
  poolMax?: number;
  /** `connectionTimeoutMillis` em vigor na instância. */
  acquireTimeoutMs?: number;
  /** Requisições em voo no instante em que o cabeçalho foi escrito. */
  inFlightCurrent?: number;
  /** Pico de requisições em voo visto por este processo desde o boot. */
  inFlightPeak?: number;
};

const storage = new AsyncLocalStorage<DbTrace>();

/**
 * Requisições EM VOO neste processo.
 *
 * A janela medida pelo cliente não serve: o harness dispara as 300 requisições
 * ao mesmo tempo, então o "pico" calculado no cliente é só a contagem de
 * requisições que caíram na mesma instância — não a sobreposição real. Para
 * decidir se `max: 1` do pool serializa, é preciso o número que o SERVIDOR
 * sabe: quantas requisições estavam sendo atendidas ao mesmo tempo pela mesma
 * instância.
 *
 * `inl`  requisições em voo no instante em que o cabeçalho foi escrito;
 * `inpk` pico de requisições em voo visto por este processo desde o boot.
 */
let inFlight = 0;
let inFlightPeak = 0;

/**
 * Token de requisição em voo.
 *
 * O decremento é idempotente por token: `exitRequest` só libera uma vez. Isso
 * fecha o bug clássico de double decrement — quando `finish` E `close` disparam
 * (resposta normal fecha o socket logo depois), ou quando o `finally` do
 * handler e o evento de socket correm juntos. Sem o token, um decremento
 * duplicado derrubaria `inFlight` abaixo de zero e a métrica `inl` mentiria.
 */
export type InFlightToken = { readonly id: number };

let tokenSeq = 0;
const openTokens = new Set<number>();

/** Abre uma requisição em voo e devolve o token de fechamento. */
export function enterRequest(): InFlightToken {
  tokenSeq += 1;
  const token: InFlightToken = { id: tokenSeq };
  openTokens.add(token.id);
  inFlight += 1;
  if (inFlight > inFlightPeak) inFlightPeak = inFlight;
  return token;
}

/**
 * Fecha uma requisição em voo. Idempotente: chamadas repetidas com o mesmo
 * token são no-ops. Retorna `true` se este chamada fez o decremento.
 */
export function exitRequest(token: InFlightToken): boolean {
  if (!openTokens.delete(token.id)) return false;
  if (inFlight > 0) inFlight -= 1;
  return true;
}

/** Estado de concorrência do processo — leitura ao vivo, nunca snapshot. */
export function inFlightState(): { current: number; peak: number } {
  return { current: inFlight, peak: inFlightPeak };
}

/** Quantas requisições estão abertas agora (checagem de integridade). */
export function openRequestCount(): number {
  return openTokens.size;
}

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
    poolMax: undefined,
    acquireTimeoutMs: undefined,
    inst: undefined,
    inFlightCurrent: undefined,
    inFlightPeak: undefined,
    sqlMs: undefined,
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
  // Métricas do pooler — sempre presentes (contexto de runtime), consistentes
  // com o que o healthz e o cliente leem. Quando o trace tem valores override,
  // eles têm prioridade; caso contrário, os valores de runtime são usados.
  //
  // `inl`/`inpk` SEMPRE vêm do estado ao vivo do processo (`inFlightState`),
  // nunca de um snapshot guardado no `runtimeInfo` — o snapshot envelhecia e
  // reportava 0 enquanto o processo atendia requisições concorrentes.
  const live = inFlightState();
  const poolMax = trace.poolMax ?? runtimeInfo.poolMax ?? 1;
  const ctmo = trace.acquireTimeoutMs ?? runtimeInfo.acquireTimeoutMs ?? 10_000;
  const inst = trace.inst ?? runtimeInfo.instanceId ?? "0";
  const inl = trace.inFlightCurrent ?? live.current;
  const inpk = trace.inFlightPeak ?? live.peak;
  const parts: string[] = [
    `total=${Math.round(trace.queryMs)}`,
    `acq=${Math.round(trace.acquireMs)}`,
    `sql=${sql}`,
    `att=${trace.attempts}`,
    `retry=${trace.retries}`,
    `acqto=${trace.acquireTimeouts}`,
    `emax=${trace.admissionErrors}`,
    `est=${trace.establishmentErrors}`,
    `bstop=${trace.budgetStops}`,
    `pmax=${poolMax}`,
    `ctmo=${ctmo}`,
    `inst=${inst}`,
    `inl=${inl}`,
    `inpk=${inpk}`,
  ];
  if (trace.sqlMs !== undefined) parts.push(`sqlMs=${trace.sqlMs}`);
  return parts.join(";");
}

/** Versão Server-Timing (padrão do navegador) do mesmo dado. */
export function traceServerTiming(trace: DbTrace): string {
  const sql = Math.max(0, Math.round(trace.queryMs - trace.acquireMs));
  return `db;dur=${Math.round(trace.queryMs)};desc="acq=${Math.round(trace.acquireMs)},sql=${sql},att=${trace.attempts},retry=${trace.retries}"`;
}

/**
 * Identidade do processo que atendeu a requisição.
 *
 * A Vercel não expõe "quantas instâncias atenderam esta rajada" por API. O
 * processo, porém, sabe: um id aleatório por boot identifica a instância. Com
 * o id e a janela de tempo de cada requisição dá para medir a concorrência
 * REAL por instância — que é o número que decide se `max: 1` do pool é
 * problema ou não.
 */
const instanceId = randomBytes(4).toString("hex");

/** Configuração de pool em vigor na instância — precisa aparecer na evidência. */
export type DbRuntimeInfo = {
  /** `max` do pool. */
  poolMax: number;
  /** `connectionTimeoutMillis` do pool. */
  acquireTimeoutMs: number;
  /** Identificador da instância do processo. */
  instanceId: string;
};

let runtimeInfo: DbRuntimeInfo = {
  poolMax: 0,
  acquireTimeoutMs: 0,
  instanceId: "",
};

export function setDbRuntimeInfo(next: DbRuntimeInfo): void {
  runtimeInfo = { ...next };
}

export function dbInstanceId(): string {
  return instanceId;
}

/**
 * Configuração de pool em vigor na instância — usada pelo healthz para expor
 * `pmax`/`ctmo`/`inst` a quem apresenta o token correto.
 */
export function runtimePoolInfo(): DbRuntimeInfo {
  return runtimeInfo;
}

/** Forma mínima da resposta HTTP usada aqui (ServerResponse satisfaz). */
type TraceResponse = {
  headersSent: boolean;
  /** `true` depois que `end()` foi chamado (corpo em.flush ou encerrado). */
  writableEnded?: boolean;
  setHeader(name: string, value: string): unknown;
  writeHead: (...args: any[]) => any;
  once?: (event: string, listener: () => void) => unknown;
  on?: (event: string, listener: () => void) => unknown;
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
 * Ciclo de vida da requisição em voo:
 *   - `enterRequest()` abre o token no início do handler;
 *   - `finish` (resposta gravada) e `close` (socket fechado, inclusive
 *     desconexão do cliente) fecham o token — o primeiro que chegar vence;
 *   - o `finally` do handler é a rede de segurança para o caso em que o
 *     handler falha ANTES de escrever qualquer resposta (`headersSent` falso),
 *     onde nenhum evento de socket vai chegar;
 *   - quando o corpo já foi encerrado (`writableEnded`), um `setImmediate`
 *     garante a liberação mesmo que o evento `finish` não dispare.
 *
 * O fechamento é idempotente por token (`exitRequest`), então `finish` + `close`
 * + `finally` juntos nunca decrementam duas vezes.
 */
export function withDbTrace<T>(res: TraceResponse, wantsTrace: boolean, fn: () => Promise<T>): Promise<T> {
  const trace = newTrace();
  const token = enterRequest();

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    exitRequest(token);
  };

  if (typeof res.once === "function") {
    res.once("finish", release);
    res.once("close", release);
  } else if (typeof res.on === "function") {
    res.on("finish", release);
    res.on("close", release);
  }

  if (wantsTrace) {
    const originalWriteHead = res.writeHead;
    res.writeHead = function patchedWriteHead(this: unknown, ...args: any[]) {
      if (!res.headersSent) {
        // Popula os campos de concorrência do rastreio a partir do estado AO
        // VIVO do processo (nunca de um snapshot) no instante em que os
        // cabeçalhos são escritos.
        const live = inFlightState();
        trace.inFlightCurrent = live.current;
        trace.inFlightPeak = live.peak;
        res.setHeader("x-db-trace", traceHeader(trace));
        res.setHeader("Server-Timing", traceServerTiming(trace));
      }
      return originalWriteHead.apply(res, args as [any]);
    };
  }

  return runWithTrace(trace, fn).finally(() => {
    if (!res.headersSent) {
      // Handler falhou antes de escrever qualquer resposta: nenhum evento de
      // socket vai chegar, a liberação é nossa.
      release();
      return;
    }
    if (res.writableEnded) {
      // Corpo já encerrado: `finish` é iminente, mas não é garantido em
      // runtimes que cortam o event loop. Libera no próximo tick.
      setImmediate(release);
    }
  });
}
