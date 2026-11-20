// language: TS, file: apps/api/src/db/db-retry.ts, target: Node 22 + node-postgres
/**
 * Retry limitado para falhas TRANSITÓRIAS de conexão com o Postgres.
 *
 * Contexto medido (staging, projeto Supabase zuejjupuxegpczgyonha):
 * o pooler em transaction mode aceita 200 clientes simultâneos por projeto
 * (`EMAXCONN: max client connections reached, limit: 200`). Uma rajada a frio
 * de 300 requisições fez a API criar instâncias suficientes para estourar o
 * teto: 200 respostas 200 e 200 respostas 500.
 *
 * Regras que este módulo respeita:
 *
 *  1. Só se repete o que PROVAVELMENTE não executou no banco:
 *     - erro de ADMISSÃO do pooler (EMAXCONN / EMAXCONNSESSION): o pooler
 *       recusou o cliente antes de executar o statement;
 *     - erro de ESTABELECIMENTO de conexão (ECONNREFUSED, ETIMEDOUT, ...):
 *       nada foi enviado ao servidor.
 *     Erros de rede depois do statement ter saído (ex.: conexão caiu com o
 *     comando já executado) NÃO são repetidos — repetir uma escrita sem
 *     idempotência duplicaria pedido, cobrança ou reserva de estoque.
 *
 *  2. O retry é ORÇADO: tentativas limitadas, backoff exponencial com jitter,
 *     e um teto de tempo total por operação.
 *
 *  3. O retry é PROTEGIDO contra tempestade: token bucket (retries por
 *     segundo) e disjuntor (breaker) que abrem quando o pooler está saturado.
 *     Nesses casos a falha é devolvida na hora — amplifying a fila do pooler
 *     só piora o incidente.
 */

import { Pool, type PoolConfig } from "pg";
import {
  noteAcquire,
  noteAttempt,
  noteBudgetStop,
  noteClassifier,
  noteQuery,
  noteRetry,
} from "./db-trace.js";

export type RetryPolicy = {
  /** Total de tentativas, incluindo a primeira (1 = sem retry). */
  attempts: number;
  /** Base do backoff exponencial. */
  baseDelayMs: number;
  /** Teto do atraso por tentativa. */
  maxDelayMs: number;
  /** Orçamento total por operação (tentativas + esperas). */
  totalTimeoutMs: number;
  /**
   * Tempo mínimo que precisa sobrar para iniciar (ou esperar por) uma nova
   * tentativa. Sem isso a última tentativa começa sem tempo de terminar e o
   * deadline estoura — foi o que levou a Opção B a 13,3 s com orçamento de 9 s.
   */
  lastAttemptReserveMs: number;
  /** Token bucket: retries liberados por segundo. */
  retriesPerSecond: number;
  /** Rajada inicial do token bucket. */
  burst: number;
  /** Falhas de admissão consecutivas que abrem o disjuntor. */
  breakerThreshold: number;
  /** Tempo que o disjuntor permanece aberto antes da meia-abertura. */
  breakerCooldownMs: number;
};

/**
 * Política B2 — ataca a AQUISIÇÃO, não o backoff.
 *
 * O experimento da Opção B (backoff espalhado até 7,6 s com orçamento de 9 s)
 * foi rejeitado: p95 pregado em ~12,4 s nas quatro rodadas, até 230 de 300
 * requisições acima de 9 s. A causa não era o tamanho do backoff — era a fila
 * interna do `pg-pool`: com `max: 1` por instância e concorrência otimizada do
 * Fluid compute, `connectionTimeoutMillis: 10_000` deixava as invocações
 * concorrentes esperando 10 s por uma conexão que nunca vinha.
 *
 * B2 inverte a ordem:
 *   - aquisição falha em 2 s (poolSizing) em vez de 10 s;
 *   - o timeout de fila do pg-pool passa a ser reconhecido e repetido;
 *   - o backoff é curto (800 ms de base, teto 2,5 s) porque a espera longa já
 *     não é feita por nós — é feita por quem tem a vaga;
 *   - orçamento de 6 s com 1,5 s reservados para a última tentativa: a cauda
 *     tem teto real, não estimado.
 *
 * `breakerThreshold` acompanha `attempts`: com threshold menor, o disjuntor
 * abriria antes da última tentativa da própria requisição e a política seria
 * truncada em silêncio.
 */
export const defaultRetryPolicy: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 800,
  maxDelayMs: 2_500,
  totalTimeoutMs: 6_000,
  lastAttemptReserveMs: 1_500,
  retriesPerSecond: 5,
  burst: 10,
  breakerThreshold: 3,
  breakerCooldownMs: 5_000,
};

/** Códigos do pooler que significam "o cliente foi recusado antes de executar". */
const ADMISSION_CODES = new Set(["EMAXCONN", "EMAXCONNSESSION"]);

/** Códigos de rede que significam "a conexão nem chegou a se estabelecer". */
const ESTABLISHMENT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNABORTED",
  "EPIPE",
]);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** Código do erro, olhando a cadeia de causas (`error.cause`). */
export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { code?: unknown; errno?: unknown; cause?: unknown };
  const code = typeof e.code === "string" ? e.code : typeof e.errno === "string" ? e.errno : undefined;
  if (code) return code;
  if (e.cause && e.cause !== error) return errorCode(e.cause);
  return undefined;
}

/**
 * O pooler recusou o cliente por limite de conexões — o statement NÃO foi
 * executado. O erro chega do Supavisor como `XX000` com "(EMAXCONN) max client
 * connections reached, limit: 200" no texto, ou como `EMAXCONNSESSION` no
 * session mode ("max clients reached in session mode - max clients are
 * limited to pool_size: 15").
 */
export function isAdmissionControlError(error: unknown): boolean {
  const code = errorCode(error)?.toUpperCase();
  if (code && ADMISSION_CODES.has(code)) return true;
  const message = errorMessage(error).toUpperCase();
  return (
    message.includes("EMAXCONN") ||
    message.includes("MAX CLIENT CONNECTIONS REACHED") ||
    message.includes("MAX CLIENTS REACHED")
  );
}

/**
 * A conexão não chegou a se estabelecer: nenhum statement foi enviado.
 * Só vale na caminho de aquisição de conexão (pool.connect).
 */
export function isConnectionEstablishmentError(error: unknown): boolean {
  const code = errorCode(error)?.toUpperCase();
  if (!code) return false;
  return ESTABLISHMENT_CODES.has(code);
}

/**
 * Timeout da FILA do `pg-pool`: `connectionTimeoutMillis` expirou esperando um
 * cliente livre do pool. Medido no incidente — com `max: 1` por instância e
 * concorrência otimizada do Fluid compute, era esta a falha dominante, e ela
 * chegava sem `code` nenhum, então nenhum classificador a reconhecia.
 *
 * A identificação exige as três condições:
 *   1. ser chamada na fase de AQUISIÇÃO (garantido pela estrutura: o
 *      classificador só é usado dentro do wrapper de `pool.connect`), nunca
 *      sobre erro vindo da execução de um statement;
 *   2. `error.code` AUSENTE — erro de SQL sempre traz SQLSTATE (`57014` para
 *      `statement_timeout`, `ETIMEDOUT` para rede); o do pg-pool não traz;
 *   3. texto exatamente igual ao que o `pg-pool` emite.
 *
 * O caminho da stack não entra como condição: o bundle da Vercel pode reescrever
 * caminhos de módulo, e uma exigência de caminho falharia em silêncio (sem
 * retry) exatamente em produção. As três condições acima já distinguem o caso.
 */
export function isPoolQueueTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message !== "timeout exceeded when trying to connect") return false;
  const code = (error as { code?: unknown }).code;
  return code === undefined || code === null;
}

/** Falhas de AQUISIÇÃO que provam que nenhum statement foi enviado. */
export function isRetryableAcquire(error: unknown): boolean {
  return isAdmissionControlError(error) || isConnectionEstablishmentError(error) || isPoolQueueTimeout(error);
}

/**
 * Backoff exponencial com jitter. Usa "equal jitter": metade do atraso é
 * garantida e a outra metade é sorteada — espalha a tempestade sem permitir
 * espera zero (que viraria laço quente).
 */
export function retryDelayMs(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  const half = capped / 2;
  return Math.floor(half + random() * half);
}

/**
 * Token bucket + disjuntor por processo. É o que impede que N instâncias
 * ampliquem a saturação do pooler: quando o bucket esvazia ou o disjuntor
 * abre, a falha volta na hora em vez de virar mais uma tentativa.
 */
export class RetryGovernor {
  private tokens: number;
  private lastRefillMs: number;
  private consecutiveFailures = 0;
  private openedAtMs: number | null = null;

  constructor(
    private readonly policy: RetryPolicy,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = policy.burst;
    this.lastRefillMs = now();
  }

  /** Disjuntor aberto? Passado o cooldown, meia-abertura: uma nova tentativa testa o pooler. */
  isOpen(): boolean {
    if (this.openedAtMs === null) return false;
    if (this.now() - this.openedAtMs >= this.policy.breakerCooldownMs) {
      this.openedAtMs = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAtMs = null;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.policy.breakerThreshold) {
      this.openedAtMs = this.now();
    }
  }

  /** Consome um token do bucket. `false` = sem permissão para repetir. */
  takeToken(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    const added = (elapsed / 1000) * this.policy.retriesPerSecond;
    this.tokens = Math.min(this.policy.burst, this.tokens + added);
    this.lastRefillMs = now;
  }
}

export type RetryOptions = {
  policy?: RetryPolicy;
  governor?: RetryGovernor;
  /** Decide se o erro merece nova tentativa. */
  isRetryable: (error: unknown) => boolean;
  /**
   * Um sucesso zera a contagem de falhas do disjuntor? Só a operação completa
   * (consulta) prova que o pooler voltou a servir. Uma conexão estabelecida
   * não prova: o statement pode ainda ser recusado por admissão.
   */
  countsAsSuccess?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown; budgetLeftMs: number }) => void;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executa `operation` com retry limitado. Lança o último erro quando o
 * orçamento acaba — nunca transforma erro em sucesso silencioso.
 */
export async function runWithDbRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const policy = options.policy ?? defaultRetryPolicy;
  const governor = options.governor ?? new RetryGovernor(policy, options.now);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const deadline = now() + policy.totalTimeoutMs;

  let attempt = 1;
  let lastError: unknown;
  for (;;) {
    // A primeira tentativa pode começar com qualquer orçamento; a partir da
    // segunda é preciso sobrar a reserva, senão a tentativa nasce sem tempo de
    // terminar e o deadline vira promessa não cumprida.
    if (attempt > 1 && deadline - now() < policy.lastAttemptReserveMs) {
      noteBudgetStop();
      throw lastError;
    }
    noteAttempt();
    try {
      const result = await operation();
      if (options.countsAsSuccess !== false) governor.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      // Erro que não é transitório de conexão: propaga sem repetir. Aqui mora
      // a garantia de idempotência — escrita que falhou por outro motivo
      // (constraint, validação, timeout do statement) NUNCA é repetida.
      if (!options.isRetryable(error)) throw error;
      // O disjuntor conta OPERAÇÕES que desistiram, não tentativas. Contar
      // tentativa faria uma única requisição abrir o disjuntor para o processo
      // inteiro (3 tentativas = threshold), e as requisições seguintes — que
      // ainda teriam orçamento para esperar a vaga — cairiam em 500 imediato.
      // Era o caminho mais curto para "p95 baixo com 300/300 de falha".
      const giveUp = (err: unknown) => {
        governor.recordFailure();
        return err;
      };
      if (attempt >= policy.attempts) throw giveUp(error);
      if (governor.isOpen()) throw error;
      if (!governor.takeToken()) throw giveUp(error);
      const delayMs = retryDelayMs(attempt, policy, random);
      // A reserva entra na conta junto com a espera: não adianta dormir 2 s
      // para acordar com 900 ms e iniciar uma tentativa que precisa de 2 s de
      // aquisição. Aqui é onde a cauda da Opção B passava de 9 s para 13 s.
      if (deadline - now() - delayMs < policy.lastAttemptReserveMs) {
        noteBudgetStop();
        throw giveUp(error);
      }
      options.onRetry?.({ attempt, delayMs, error, budgetLeftMs: Math.max(0, deadline - now()) });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

/** Forma mínima do pool do node-postgres usada pelo patch. */
export type PoolLike = {
  query: (...args: any[]) => any;
  connect: (...args: any[]) => any;
};

export type InstallOptions = {
  policy?: RetryPolicy;
  governor?: RetryGovernor;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown; budgetLeftMs: number; phase: "query" | "connect" }) => void;
};

/**
 * Instala a política de retry no pool.
 *
 * `pool.query` — caminho do drizzle nas consultas comuns. Repete SOMENTE a
 * recusa de admissão do pooler (`EMAXCONN`), que prova que o statement não
 * rodou. Erro de statement nunca é repetido.
 *
 * `pool.connect` — fase de AQUISIÇÃO, usada pelas transações e pelo próprio
 * `pool.query` internamente. Aqui repetir é seguro por definição: sem cliente,
 * nenhum statement saiu. Cobre fila do pg-pool, admissão do pooler e falha de
 * estabelecimento.
 *
 * As duas camadas não se multiplicam: quando a aquisição esgota as tentativas,
 * o erro sai marcado e a camada de consulta não tenta de novo (senão seriam
 * 3 × 3 tentativas escondidas atrás de uma requisição).
 *
 * Statements executados em uma transação já aberta NÃO são repetidos: eles
 * passam pelo cliente já retirado do pool (`client.query`), fora do patch.
 */
export function installDbRetry(
  pool: PoolLike,
  options: InstallOptions = {},
): { policy: RetryPolicy; governor: RetryGovernor } {
  const policy = options.policy ?? defaultRetryPolicy;
  const governor = options.governor ?? new RetryGovernor(policy, options.now);
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  const clock = options.now ?? Date.now;

  /** Erros que já gastaram o orçamento na aquisição — não podem ser repetidos de novo. */
  const acquireExhausted = new WeakSet<object>();

  const base = {
    policy,
    governor,
    now: options.now,
    sleep: options.sleep,
    random: options.random,
  };

  const mutable = pool as PoolLike;

  const classifyAcquire = (error: unknown): void => {
    if (isPoolQueueTimeout(error)) noteClassifier("acquireTimeout");
    else if (isAdmissionControlError(error)) noteClassifier("admission");
    else if (isConnectionEstablishmentError(error)) noteClassifier("establishment");
  };

  const markExhausted = (error: unknown): void => {
    if (error && typeof error === "object") acquireExhausted.add(error as object);
  };

  const isRetryableQuery = (error: unknown): boolean => {
    if (error && typeof error === "object" && acquireExhausted.has(error as object)) return false;
    if (!isAdmissionControlError(error)) return false;
    noteClassifier("admission");
    return true;
  };

  /** Envolve uma chamada de aquisição medindo o tempo e registrando a causa da falha. */
  const acquire = async <T>(run: () => Promise<T>): Promise<T> => {
    const started = clock();
    try {
      return await run();
    } finally {
      noteAcquire(clock() - started);
    }
  };

  mutable.query = function patchedQuery(text: any, values?: any, callback?: any) {
    if (typeof values === "function") {
      callback = values;
      values = undefined;
    }

    const runOnce = async () => {
      const started = clock();
      try {
        return await originalQuery(text, values);
      } finally {
        noteQuery(clock() - started);
      }
    };

    const attempt = () =>
      runWithDbRetry(runOnce, {
        ...base,
        isRetryable: isRetryableQuery,
        onRetry: (info) => {
          noteRetry(`query:${errorCode(info.error) ?? errorMessage(info.error).slice(0, 40)}`);
          options.onRetry?.({ ...info, phase: "query" });
        },
      });

    if (typeof callback === "function") {
      attempt().then(
        (result) => callback(null, result),
        (error) => callback(error),
      );
      return undefined;
    }
    return attempt();
  };

  mutable.connect = function patchedConnect(callback?: any) {
    const attempt = () =>
      acquire(() =>
        runWithDbRetry(() => originalConnect(), {
          ...base,
          isRetryable: (error) => {
            const retryable = isRetryableAcquire(error);
            if (retryable) classifyAcquire(error);
            return retryable;
          },
          // Uma conexão estabelecida não zera o disjuntor: o pooler pode recusar
          // o statement logo depois. Quem zera é a consulta completa.
          countsAsSuccess: false,
          onRetry: (info) => {
            noteRetry(`acquire:${errorCode(info.error) ?? "sem-code"}`);
            options.onRetry?.({ ...info, phase: "connect" });
          },
        }).catch((error) => {
          markExhausted(error);
          throw error;
        }),
      );

    if (typeof callback === "function") {
      attempt().then(
        (client: any) => callback(null, client, () => client.release()),
        (error: unknown) => callback(error),
      );
      return undefined;
    }
    return attempt();
  };

  return { policy, governor };
}

/** Cria um pool do node-postgres com a política de retry instalada. */
export function createResilientPool(config: PoolConfig, options: InstallOptions = {}): Pool {
  const pool = new Pool(config);
  installDbRetry(pool as unknown as PoolLike, options);
  return pool;
}
