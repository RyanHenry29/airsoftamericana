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
  isPoolQueueTimeout,
  isRetryableAcquire,
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
    // Duas operações desistindo; no meio delas a conexão continua subindo e
    // caindo sem zerar a contagem — só a consulta completa zera.
    for (let i = 0; i < 2; i++) {
      await expect(
        runWithDbRetry(failing, {
          policy: policy({ attempts: 2 }),
          governor,
          isRetryable: isAdmissionControlError,
          sleep,
          random: () => 1,
        }),
      ).rejects.toThrow(/EMAXCONN/);
    }
    expect(governor.isOpen()).toBe(true);
  });

  it("abre o disjuntor após operações consecutivas que desistiram", async () => {    const governor = new RetryGovernor(policy({ breakerThreshold: 2, breakerCooldownMs: 10_000 }));
    const sleep = vi.fn(async () => {});
    const failing = vi.fn(async () => {
      throw ESTABLISHMENT;
    });
    // Duas operações esgotando o próprio orçamento — não duas tentativas da
    // mesma operação. Uma requisição sozinha não pode abrir o disjuntor para o
    // processo inteiro.
    for (let i = 0; i < 2; i++) {
      await expect(
        runWithDbRetry(failing, {
          policy: policy({ attempts: 2 }),
          governor,
          isRetryable: isConnectionEstablishmentError,
          sleep,
          random: () => 1,
        }),
      ).rejects.toThrow(/ECONNREFUSED/);
    }
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
    expect(sleep).toHaveBeenCalledTimes(2); // uma espera por operação, nenhuma na terceira
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
    expect(onRetry.mock.calls[0]?.[0]).toHaveProperty("budgetLeftMs");
  });
});

describe("política B2 (aquisição)", () => {
  it("mantém os parâmetros exigidos para a rodada de Preview", () => {
    expect(defaultRetryPolicy).toMatchObject({
      attempts: 3,
      baseDelayMs: 800,
      maxDelayMs: 2_500,
      totalTimeoutMs: 6_000,
      lastAttemptReserveMs: 1_500,
      retriesPerSecond: 5,
      burst: 10,
    });
    expect(defaultRetryPolicy.lastAttemptReserveMs).toBeGreaterThanOrEqual(1_500);
  });

  it("não abre o disjuntor antes da última tentativa da própria requisição", () => {
    // Com threshold < attempts o disjuntor abriria na falha anterior à última e
    // a política seria truncada em silêncio.
    expect(defaultRetryPolicy.breakerThreshold).toBeGreaterThanOrEqual(defaultRetryPolicy.attempts);
  });

  it("gasta as três tentativas antes de desistir", async () => {
    const operation = vi.fn(async () => {
      throw ADMISSION;
    });
    const sleep = vi.fn(async () => {});
    await expect(
      runWithDbRetry(operation, {
        policy: defaultRetryPolicy,
        isRetryable: isAdmissionControlError,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/EMAXCONN/);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("cabe no orçamento: esperas + reserva da última tentativa abaixo do total", () => {
    const waits = [1, 2].map((a) => retryDelayMs(a, defaultRetryPolicy, () => 1));
    expect(waits).toEqual([800, 1_600]);
    expect(waits.reduce((a, b) => a + b, 0) + defaultRetryPolicy.lastAttemptReserveMs).toBeLessThan(
      defaultRetryPolicy.totalTimeoutMs,
    );
  });

  it("recusa o retry quando a espera comeria a reserva da última tentativa", async () => {
    // Aquisição de 2 s por tentativa, orçamento de 6 s, reserva de 1,5 s:
    // depois da segunda falha não sobra tempo útil, e uma terceira tentativa
    // começaria já fora do deadline. A Opção B falhou exatamente aqui — ela
    // iniciava mesmo assim e estourava o orçamento em 4 s.
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const operation = vi.fn(async () => {
      clock += 2_000;
      throw Object.assign(new Error("timeout exceeded when trying to connect"), {});
    });
    await expect(
      runWithDbRetry(operation, {
        policy: defaultRetryPolicy,
        isRetryable: isPoolQueueTimeout,
        now: () => clock,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/timeout exceeded/);
    expect(clock).toBeLessThanOrEqual(defaultRetryPolicy.totalTimeoutMs);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("não inicia tentativa que já nasceu fora do orçamento", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const operation = vi.fn(async () => {
      clock += 5_000;
      throw ADMISSION;
    });
    await expect(
      runWithDbRetry(operation, {
        policy: defaultRetryPolicy,
        isRetryable: isAdmissionControlError,
        now: () => clock,
        sleep,
        random: () => 1,
      }),
    ).rejects.toThrow(/EMAXCONN/);
    expect(clock).toBeLessThanOrEqual(6_000);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("classificação do timeout de fila do pg-pool", () => {
  // O pg-pool cria este erro em `new Error(...)`, sem `code`:
  //   this.options.connectionTimeoutMillis && setTimeout(() => response.callback(
  //     new Error('timeout exceeded when trying to connect')), millis)
  const queueTimeout = () => new Error("timeout exceeded when trying to connect");

  it("reconhece o timeout de fila emitido sem código", () => {
    expect(isPoolQueueTimeout(queueTimeout())).toBe(true);
  });

  it("NÃO reconhece timeout de statement (SQLSTATE 57014)", () => {
    // `statement_timeout` do Postgres chega com código — repetir aqui é repetir
    // uma consulta que o servidor já executou e cancelou.
    const statementTimeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    expect(isPoolQueueTimeout(statementTimeout)).toBe(false);
    expect(isRetryableAcquire(statementTimeout)).toBe(false);
  });

  it("NÃO reconhece timeout de rede (ETIMEDOUT)", () => {
    expect(isPoolQueueTimeout(Object.assign(new Error("timeout exceeded when trying to connect"), { code: "ETIMEDOUT" }))).toBe(
      false,
    );
  });

  it("NÃO reconhece mensagem parecida com outra origem", () => {
    expect(isPoolQueueTimeout(new Error("timeout exceeded when trying to connect to 10.0.0.1"))).toBe(false);
    expect(isPoolQueueTimeout(new Error("Connection terminated due to connection timeout"))).toBe(false);
    expect(isPoolQueueTimeout("timeout exceeded when trying to connect")).toBe(false);
    expect(isPoolQueueTimeout(undefined)).toBe(false);
  });

  it("trata admissão e estabelecimento como recuperáveis na aquisição", () => {
    expect(isRetryableAcquire(ADMISSION)).toBe(true);
    expect(isRetryableAcquire(ESTABLISHMENT)).toBe(true);
    expect(isRetryableAcquire(STATEMENT_ERROR)).toBe(false);
  });
});

describe("fronteira entre as duas camadas de retry", () => {
  it("repete a aquisição quando a fila do pool estoura", async () => {
    const { pool, connects } = fakePool([], [new Error("timeout exceeded when trying to connect"), "ok"]);
    installDbRetry(pool, { policy: policy(), sleep: async () => {}, random: () => 1 });
    const client = await pool.connect();
    expect(client).toBeTruthy();
    expect(connects).toHaveLength(2);
  });

  it("NÃO repete a consulta quando o erro de fila chega na fase de query", async () => {
    // Sem identificação de que o erro veio da aquisição, a camada de consulta
    // não tem como provar que o statement não rodou. Antes de repetir, não.
    const { pool, queries } = fakePool([new Error("timeout exceeded when trying to connect"), "ok"]);
    installDbRetry(pool, { policy: policy(), sleep: async () => {}, random: () => 1 });
    await expect(pool.query("select 1")).rejects.toThrow(/timeout exceeded/);
    expect(queries).toHaveLength(1);
  });

  it("não multiplica as camadas: aquisição esgotada não é repetida na consulta", async () => {
    // pg-pool resolve `pool.query` chamando o `connect` da instância — que é o
    // nosso patch. Sem a marca, a consulta repetiria 3 × 3 = 9 tentativas
    // escondidas atrás de uma requisição.
    const connects: number[] = [];
    const pool = {
      query: async () => {
        const client: any = await (pool as any).connect();
        return client.query();
      },
      connect: async () => {
        connects.push(1);
        throw ADMISSION;
      },
    } as any;
    installDbRetry(pool, { policy: policy(), sleep: async () => {}, random: () => 1 });
    await expect(pool.query("select 1")).rejects.toThrow(/EMAXCONN/);
    expect(connects).toHaveLength(3); // só as tentativas da aquisição
  });
});

describe("idempotência sob falha de rede", () => {
  it("NÃO repete consulta quando a conexão caiu com o statement possivelmente executado", async () => {
    // ECONNRESET na fase de query: o comando pode ter chegado ao Postgres.
    // Repetir uma escrita aqui duplicaria pedido, cobrança ou reserva.
    const droppedMidStatement = Object.assign(new Error("connection terminated unexpectedly"), {
      code: "ECONNRESET",
    });
    const { pool, queries } = fakePool([droppedMidStatement, "ok"]);
    installDbRetry(pool, { policy: defaultRetryPolicy, sleep: async () => {} });
    await expect(pool.query("insert into orders ...")).rejects.toThrow(/terminated/);
    expect(queries).toHaveLength(1);
  });
});

describe("governor sob concorrência", () => {
  it("limita a amplificação quando 200 requisições falham ao mesmo tempo", async () => {
    // Cenário do incidente: 300 instâncias frias, pooler saturado. O bucket e o
    // disjuntor são por processo — este teste prova que, dentro de UMA
    // instância, a frota de requisições concorrentes não multiplica retries.
    const governor = new RetryGovernor(defaultRetryPolicy);
    const operation = vi.fn(async () => {
      throw ADMISSION;
    });
    const sleep = async () => {
      await Promise.resolve();
    };

    const results = await Promise.allSettled(
      Array.from({ length: 200 }, () =>
        runWithDbRetry(operation, {
          policy: defaultRetryPolicy,
          governor,
          isRetryable: isAdmissionControlError,
          sleep,
          random: () => 1,
        }),
      ),
    );

    const failures = results.filter((r) => r.status === "rejected").length;
    expect(failures).toBe(200); // nenhuma falha virou sucesso silencioso
    // 200 primeiras tentativas + retries limitados pelo bucket/disjuntor.
    // Sem a trava seriam 200 x 4 = 800 tentativas.
    expect(operation.mock.calls.length).toBeLessThan(300);
    expect(governor.isOpen()).toBe(true);
  });
});
