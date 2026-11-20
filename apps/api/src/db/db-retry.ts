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

export type RetryPolicy = {
  /** Total de tentativas, incluindo a primeira (1 = sem retry). */
  attempts: number;
  /** Base do backoff exponencial. */
  baseDelayMs: number;
  /** Teto do atraso por tentativa. */
  maxDelayMs: number;
  /** Orçamento total por operação (tentativas + esperas). */
  totalTimeoutMs: number;
  /** Token bucket: retries liberados por segundo. */
  retriesPerSecond: number;
  /** Rajada inicial do token bucket. */
  burst: number;
  /** Falhas de admissão consecutivas que abrem o disjuntor. */
  breakerThreshold: number;
  /** Tempo que o disjuntor permanece aberto antes da meia-abertura. */
  breakerCooldownMs: number;
};

export const defaultRetryPolicy: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 120,
  maxDelayMs: 1_200,
  totalTimeoutMs: 5_000,
  retriesPerSecond: 10,
  burst: 20,
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
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
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
  for (;;) {
    try {
      const result = await operation();
      if (options.countsAsSuccess !== false) governor.recordSuccess();
      return result;
    } catch (error) {
      // Erro que não é transitório de conexão: propaga sem repetir. Aqui mora
      // a garantia de idempotência — escrita que falhou por outro motivo
      // (constraint, validação, timeout do statement) NUNCA é repetida.
      if (!options.isRetryable(error)) throw error;
      // Falha de admissão/estabelecimento conta para o disjuntor: o pooler
      // saturado precisa parar de receber novas tentativas, não multiplicá-las.
      governor.recordFailure();
      if (attempt >= policy.attempts) throw error;
      if (governor.isOpen()) throw error;
      if (!governor.takeToken()) throw error;
      if (now() >= deadline) throw error;
      const delayMs = retryDelayMs(attempt, policy, random);
      options.onRetry?.({ attempt, delayMs, error });
      if (now() + delayMs > deadline) throw error;
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
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown; phase: "query" | "connect" }) => void;
};

/**
 * Instala a política de retry no pool.
 *
 * `pool.query` — caminho do drizzle nas consultas comuns: a falha de admissão
 * do pooler chega aqui e o statement não foi executado, logo repetir é seguro.
 *
 * `pool.connect` — caminho das transações e do CLI de migrations: aqui a
 * falha é de estabelecimento de conexão, nada foi enviado.
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

  const base = {
    policy,
    governor,
    now: options.now,
    sleep: options.sleep,
    random: options.random,
  };

  const mutable = pool as PoolLike;

  mutable.query = function patchedQuery(text: any, values?: any, callback?: any) {
    if (typeof values === "function") {
      callback = values;
      values = undefined;
    }
    if (typeof callback === "function") {
      runWithDbRetry(() => originalQuery(text, values), {
        ...base,
        isRetryable: isAdmissionControlError,
        onRetry: (info) => options.onRetry?.({ ...info, phase: "query" }),
      }).then(
        (result) => callback(null, result),
        (error) => callback(error),
      );
      return undefined;
    }
    return runWithDbRetry(() => originalQuery(text, values), {
      ...base,
      isRetryable: isAdmissionControlError,
      onRetry: (info) => options.onRetry?.({ ...info, phase: "query" }),
    });
  };

  mutable.connect = function patchedConnect(callback?: any) {
    if (typeof callback === "function") {
      runWithDbRetry(() => originalConnect(), {
        ...base,
        isRetryable: isConnectionEstablishmentError,
        countsAsSuccess: false,
        onRetry: (info) => options.onRetry?.({ ...info, phase: "connect" }),
      }).then(
        (client: any) => callback(null, client, () => client.release()),
        (error: unknown) => callback(error),
      );
      return undefined;
    }
    return runWithDbRetry(() => originalConnect(), {
      ...base,
      isRetryable: isConnectionEstablishmentError,
      // Uma conexão estabelecida não zera o disjuntor: o pooler pode recusar o
      // statement logo depois. Quem zera é a consulta completa.
      countsAsSuccess: false,
      onRetry: (info) => options.onRetry?.({ ...info, phase: "connect" }),
    });
  };

  return { policy, governor };
}

/** Cria um pool do node-postgres com a política de retry instalada. */
export function createResilientPool(config: PoolConfig, options: InstallOptions = {}): Pool {
  const pool = new Pool(config);
  installDbRetry(pool as unknown as PoolLike, options);
  return pool;
}
