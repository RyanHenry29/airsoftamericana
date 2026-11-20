// language: TS, file: apps/api/src/db/db-retry.test.ts, target: vitest
// Retry limitado de conexão: orçamento, jitter, trava de tempestade e a
// garantia de não repetir escrita sem idempotência.
import { describe, expect, it, vi } from "vitest";
import {
  RetryGovernor,
  defaultRetryPolicy,
  installDbRetry,
  isAdmissionControlError,
  isConnectionEstablishmentError,
  retryDelayMs,
  runWithDbRetry,
  type PoolLike,
  type RetryPolicy,
} from "./db-retry.js";

const ADMISSION = Object.assign(new Error("(EMAXCONN) max client connections reached, limit: 200"), {
  code: "XX000",
});
const ADMISSION_SESSION = Object.assign(new Error("max clients reached in session mode - max clients are limited to pool_size: 15"), {
  code: "EMAXCONNSESSION",
});
const ESTABLISHMENT = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
const STATEMENT_ERROR = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });

function policy(over: Partial<RetryPolicy> = {}): RetryPolicy {
  return { ...defaultRetryPolicy, attempts: 3, baseDelayMs: 10, maxDelayMs: 40, totalTimeoutMs: 5_000, ...over };
}

/** Pool falso: cada chamada de `query` consome o próximo comportamento da fila. */
function fakePool(queryBehaviors: Array<"ok" | Error>, connectBehaviors: Array<"ok" | Error> = []) {
  const queries: any[] = [];
  const connects: any[] = [];
  const q = [...queryBehaviors];
  const c = [...connectBehaviors];
  const pool: PoolLike = {
    query: async (...args: any[]) => {
      queries.push(args);
      const next = q.shift();
      if (next instanceof Error) throw next;
      return { rows: [], ok: true };
    },
    connect: async () => {
      connects.push(1);
      const next = c.shift();
      if (next instanceof Error) throw next;
      return { release: () => {}, query: async () => ({ rows: [] }) } as any;
    },
  };
  return { pool, queries, connects };
}

describe("classificação de erro", () => {
  it("reconhece recusa de admissão do pooler (EMAXCONN / EMAXCONNSESSION)", () => {
    expect(isAdmissionControlError(ADMISSION)).toBe(true);
    expect(isAdmissionControlError(ADMISSION_SESSION)).toBe(true);
    expect(isAdmissionControlError(Object.assign(new Error("x"), { code: "EMAXCONN" }))).toBe(true);
  });

  it("não confunde erro de statement com recusa de admissão", () => {
    expect(isAdmissionControlError(STATEMENT_ERROR)).toBe(false);
    expect(isAdmissionControlError(new Error("connection terminated unexpectedly"))).toBe(false);
  });

  it("reconhece falha de estabelecimento de conexão", () => {
    expect(isConnectionEstablishmentError(ESTABLISHMENT)).toBe(true);
    expect(isConnectionEstablishmentError(ADMISSION)).toBe(false);
    expect(isConnectionEstablishmentError(STATEMENT_ERROR)).toBe(false);
  });
});

describe("backoff", () => {
  it("cresce exponencialmente e respeita o teto", () => {
    const p = policy({ baseDelayMs: 100, maxDelayMs: 400 });
    // equal jitter: atraso = capped/2 + random*(capped/2); com random=1 => capped
    expect(retryDelayMs(1, p, () => 1)).toBe(100);
    expect(retryDelayMs(2, p, () => 1)).toBe(200);
    expect(retryDelayMs(3, p, () => 1)).toBe(400);
    expect(retryDelayMs(4, p, () => 1)).toBe(400); // capped em maxDelayMs
  });

  it("nunca devolve atraso zero (evita laço quente)", () => {
    const p = policy({ baseDelayMs: 100, maxDelayMs: 400 });
    expect(retryDelayMs(1, p, () => 0)).toBe(50);
  });
});

describe("runWithDbRetry", () => {
  it("repete erro transitório até o limite de tentativas e devolve o erro", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw ESTABLISHMENT;
    });
    await expect(
      runWithDbRetry(operation, {
        policy: policy(),
        isRetryable: isConnectionEstablishmentError,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("não repete erro que não é transitório", async () => {
    const operation = vi.fn(async () => {
      throw STATEMENT_ERROR;
    });
    await expect(
      runWithDbRetry(operation, { policy: policy(), isRetryable: isAdmissionControlError }),
    ).rejects.toThrow(/duplicate key/);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("respeita o timeout total: não há espera que estoure a janela", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const operation = vi.fn(async () => {
      throw ESTABLISHMENT;
    });
    await expect(
      runWithDbRetry(operation, {
        policy: policy({ attempts: 10, totalTimeoutMs: 30, baseDelayMs: 20, maxDelayMs: 20 }),
        isRetryable: isConnectionEstablishmentError,
        now: () => clock,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(operation.mock.calls.length).toBeLessThan(10);
    expect(clock).toBeLessThanOrEqual(30);
  });

  it("trava a tempestade: bucket de tokens vazio devolve o erro na hora", async () => {
    const governor = new RetryGovernor(policy({ burst: 1, retriesPerSecond: 0.0001, breakerThreshold: 99 }));
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw ESTABLISHMENT;
    });
    await expect(
      runWithDbRetry(operation, {
        policy: policy({ attempts: 5 }),
        governor,
        isRetryable: isConnectionEstablishmentError,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    // 1 token no bucket: uma espera; as tentativas seguintes não esperam mais.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(operation.mock.calls.length).toBeLessThan(5);
  });

  it("conexão estabelecida não zera o disjuntor (só a consulta completa zera)", async () => {
    const governor = new RetryGovernor(policy({ breakerThreshold: 2, breakerCooldownMs: 10_000 }));
    const sleep = vi.fn(async () => {});
    const connect = vi.fn(async () => "conectado");
    await runWithDbRetry(connect, {
      policy: policy(),
      governor,
      isRetryable: isConnectionEstablishmentError,
      countsAsSuccess: false,
      sleep,
    });
    const failing = vi.fn(async () => {
      throw ADMISSION;
    });
    await expect(
      runWithDbRetry(failing, {
        policy: policy({ attempts: 2 }),
        governor,
        isRetryable: isAdmissionControlError,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/EMAXCONN/);
    expect(governor.isOpen()).toBe(true);
  });

  it("abre o disjuntor após falhas consecutivas e falha na hora depois disso", async () => {    const governor = new RetryGovernor(policy({ breakerThreshold: 2, breakerCooldownMs: 10_000 }));
    const sleep = vi.fn(async () => {});
    const failing = vi.fn(async () => {
      throw ESTABLISHMENT;
    });
    await expect(
      runWithDbRetry(failing, {
        policy: policy({ attempts: 2 }),
        governor,
        isRetryable: isConnectionEstablishmentError,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(governor.isOpen()).toBe(true);

    const afterOpen = vi.fn(async () => {
      throw ESTABLISHMENT;
    });
    await expect(
      runWithDbRetry(afterOpen, {
        policy: policy({ attempts: 5 }),
        governor,
        isRetryable: isConnectionEstablishmentError,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(afterOpen).toHaveBeenCalledTimes(1); // falhou na hora: o disjuntor bloqueou o retry
    expect(sleep).toHaveBeenCalledTimes(1); // só a espera da primeira operação
  });
});

describe("installDbRetry no pool", () => {
  it("repete a consulta quando o pooler recusa o cliente (statement não executado)", async () => {
    const { pool, queries } = fakePool([ADMISSION, "ok"]);
    const sleep = vi.fn(async () => {});
    installDbRetry(pool, { policy: policy(), sleep, random: () => 1 });
    const result = await pool.query("select 1");
    expect(result).toEqual({ rows: [], ok: true });
    expect(queries).toHaveLength(2);
  });

  it("NÃO repete a consulta quando o erro é do statement (idempotência)", async () => {
    const { pool, queries } = fakePool([STATEMENT_ERROR, "ok"]);
    installDbRetry(pool, { policy: policy(), sleep: async () => {} });
    await expect(pool.query("insert into orders ...")).rejects.toThrow(/duplicate key/);
    expect(queries).toHaveLength(1);
  });

  it("repete a aquisição de conexão quando a conexão nem se estabeleceu", async () => {
    const { pool, connects } = fakePool([], [ESTABLISHMENT, "ok"]);
    installDbRetry(pool, { policy: policy(), sleep: async () => {}, random: () => 1 });
    const client = await pool.connect();
    expect(client).toBeTruthy();
    expect(connects).toHaveLength(2);
  });

  it("não repete a aquisição quando o erro é de credencial", async () => {
    const authError = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    const { pool, connects } = fakePool([], [authError, "ok"]);
    installDbRetry(pool, { policy: policy(), sleep: async () => {} });
    await expect(pool.connect()).rejects.toThrow(/authentication failed/);
    expect(connects).toHaveLength(1);
  });

  it("mantém a forma com callback do node-postgres", async () => {
    const { pool } = fakePool([ADMISSION, "ok"]);
    installDbRetry(pool, { policy: policy(), sleep: async () => {}, random: () => 1 });
    const result = await new Promise((resolve, reject) => {
      pool.query("select 1", (error: unknown, value: unknown) => (error ? reject(error) : resolve(value)));
    });
    expect(result).toEqual({ rows: [], ok: true });
  });

  it("registra o retry para observabilidade", async () => {
    const { pool } = fakePool([ADMISSION, "ok"]);
    const onRetry = vi.fn();
    installDbRetry(pool, { policy: policy(), sleep: async () => {}, random: () => 1, onRetry });
    await pool.query("select 1");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({ attempt: 1, phase: "query" });
  });
});
