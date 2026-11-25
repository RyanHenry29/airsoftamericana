// language: TS, file: apps/api/src/db/db-trace.test.ts, target: vitest
// Instrumentação por requisição: a evidência precisa sair na resposta — também
// na resposta de erro — e cada requisição precisa do próprio acumulador.
//
// ESTE ARQUIVO PROVA CONCORRÊNCIA REAL:
//   - barreira sincronizada (nenhuma requisição termina antes de todas
//     chegarem) para garantir sobreposição no MESMO processo;
//   - o pico (`inpk`) tem de refletir a sobreposição observada;
//   - o contador corrente tem de voltar a zero depois que tudo termina.
import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  newTrace,
  noteAcquire,
  noteAttempt,
  noteQuery,
  noteRetry,
  traceHeader,
  traceServerTiming,
  withDbTrace,
  setDbRuntimeInfo,
  inFlightState,
  openRequestCount,
} from "./db-trace.js";

let server: http.Server;
let base = "";

/**
 * Barreira de N parties: todas precisam chegar antes de qualquer uma seguir.
 * Sem isto, o `fetch` do Node serializa as conexões e o teste mede 1, não 3.
 */
function barrier(parties: number): { wait: () => Promise<void>; arrived: () => number } {
  let count = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arrived: () => count,
    wait: async () => {
      count += 1;
      if (count >= parties) release();
      await gate;
    },
  };
}

/** Aguarda o contador de requisições em voo voltar a zero. */
async function waitUntilIdle(timeoutMs = 2_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (openRequestCount() === 0 && inFlightState().current === 0) return 0;
    if (Date.now() > deadline) return openRequestCount();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Sinaliza a entrada do handler — usado pelo teste de desconexão. */
let onRequestStart: (() => void) | null = null;

beforeAll(async () => {
  // Configura runtime info para o teste (valores de desenvolvimento)
  setDbRuntimeInfo({
    poolMax: 5,
    acquireTimeoutMs: 10_000,
    instanceId: "abcdef01",
  });
  server = http.createServer((req, res) => {
    void withDbTrace(res, req.headers["x-db-trace"] !== undefined, async () => {
      const url = req.url ?? "/";
      if (url === "/lento") {
        await new Promise<void>((resolve) => setTimeout(resolve, 80));
      }
      if (url === "/lento-sinal") {
        // Avisa o teste de que o handler já está em voo — o abort do cliente
        // acontece DEPOIS deste sinal, ou seja, com a requisição aberta.
        onRequestStart?.();
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      if (url === "/falha") {
        noteAttempt();
        noteAcquire(1_500);
        noteQuery(1_500);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "internal_error" } }));
        return;
      }
      if (url === "/retry") {
        noteAttempt();
        noteAttempt();
        noteAcquire(2_000);
        noteQuery(2_050);
        noteRetry("acquire:sem-code");
      } else {
        noteAttempt();
        noteAcquire(30);
        noteQuery(180);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  await waitUntilIdle();
});

describe("formato do cabeçalho", () => {
  it("separa aquisição de execução SQL", () => {
    const trace = newTrace();
    trace.attempts = 2;
    trace.acquireMs = 1_400;
    trace.queryMs = 1_900;
    trace.poolMax = 5;
    trace.acquireTimeoutMs = 10_000;
    trace.inst = "abcdef01";
    trace.inFlightCurrent = 3;
    trace.inFlightPeak = 4;
    expect(traceHeader(trace)).toMatch(
      /^total=1900;acq=1400;sql=500;att=2;retry=0;acqto=0;emax=0;est=0;bstop=0;pmax=5;ctmo=10000;inst=abcdef01;inl=3;inpk=4$/,
    );
    expect(traceServerTiming(trace)).toBe('db;dur=1900;desc="acq=1400,sql=500,att=2,retry=0"');
  });

  it("nunca reporta SQL negativo quando a aquisição é maior", () => {
    const trace = newTrace();
    trace.acquireMs = 500;
    trace.queryMs = 400;
    expect(traceHeader(trace)).toContain("sql=0");
  });
});

describe("withDbTrace", () => {
  it("emite a trilha quando a requisição pede", async () => {
    const res = await fetch(`${base}/ok`, { headers: { "x-db-trace": "1" } });
    expect(res.status).toBe(200);
    const trace = res.headers.get("x-db-trace") ?? "";
    expect(trace).toMatch(/^total=180;acq=30;sql=150;att=1;retry=0;acqto=0;emax=0;est=0;bstop=0;pmax=\d+;ctmo=10000;inst=[0-9a-f]{8};inl=\d+;inpk=\d+$/);
    expect(res.headers.get("server-timing")).toContain("db;dur=180");
  });

  it("não emite nada para o cliente comum", async () => {
    const res = await fetch(`${base}/ok`);
    expect(res.headers.get("x-db-trace")).toBeNull();
    expect(res.headers.get("server-timing")).toBeNull();
  });

  it("emite a trilha também quando a requisição falha", async () => {
    // A evidência mais importante é a da requisição que deu 500: sem ela,
    // saturação vira "erro interno" opaco no relatório.
    const res = await fetch(`${base}/falha`, { headers: { "x-db-trace": "1" } });
    expect(res.status).toBe(500);
    expect(res.headers.get("x-db-trace")).toContain("acq=1500");
    await res.text();
  });

  it("cada requisição tem o próprio acumulador", async () => {
    const [a, b] = await Promise.all([
      fetch(`${base}/ok`, { headers: { "x-db-trace": "1" } }),
      fetch(`${base}/retry`, { headers: { "x-db-trace": "1" } }),
    ]);
    const ta = a.headers.get("x-db-trace") ?? "";
    const tb = b.headers.get("x-db-trace") ?? "";
    expect(ta).toContain("att=1");
    expect(ta).toContain("retry=0");
    expect(tb).toContain("att=2");
    expect(tb).toContain("retry=1");
    expect(tb).toContain("acq=2000");
    // nenhum vazamento de uma requisição para a outra
    expect(ta).toContain("acq=30");
  });
});

/**
 * CONCURRÊNCIA REAL — o bloco que o Code Review apontou como enfraquecido.
 * A asserção original (`>= 2`) foi restaurada com barreira sincronizada.
 */
describe("concorrência real do processo", () => {
  it("uma requisição isolada registra pico 1", async () => {
    const res = await fetch(`${base}/lento`, { headers: { "x-db-trace": "1" } });
    const trace = res.headers.get("x-db-trace") ?? "";
    const inpk = Number(/inpk=(\d+)/.exec(trace)?.[1] ?? -1);
    const inl = Number(/inl=(\d+)/.exec(trace)?.[1] ?? -1);
    expect(inl).toBeGreaterThanOrEqual(1);
    expect(inpk).toBeGreaterThanOrEqual(1);
    await res.text();
  });

  it("três requisições simultâneas registram pico >= 2", async () => {
    const gate = barrier(3);
    const servidor = http.createServer((req, res) => {
      void withDbTrace(res, req.headers["x-db-trace"] !== undefined, async () => {
        await gate.wait();
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const porta = (servidor.address() as { port: number }).port;
    const url = `http://127.0.0.1:${porta}/barreira`;

    const respostas = await Promise.all([
      fetch(url, { headers: { "x-db-trace": "1" } }),
      fetch(url, { headers: { "x-db-trace": "1" } }),
      fetch(url, { headers: { "x-db-trace": "1" } }),
    ]);

    expect(gate.arrived()).toBe(3);

    const picos = respostas.map((r) => Number(/inpk=(\d+)/.exec(r.headers.get("x-db-trace") ?? "")?.[1] ?? 0));
    const correntes = respostas.map((r) => Number(/inl=(\d+)/.exec(r.headers.get("x-db-trace") ?? "")?.[1] ?? 0));

    // A ASSERÇÃO ORIGINAL RESTAURADA: pico >= 2 comprova sobreposição real.
    expect(Math.max(...picos)).toBeGreaterThanOrEqual(2);
    // As três requisições estavam em voo ao mesmo tempo.
    expect(Math.max(...correntes)).toBeGreaterThanOrEqual(2);

    for (const r of respostas) await r.text();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));

    // O contador tem de voltar a zero — nada vazou.
    expect(await waitUntilIdle()).toBe(0);
    expect(inFlightState().current).toBe(0);
  });

  it("dez requisições simultâneas registram pico >= 2 e liberam tudo", async () => {
    const gate = barrier(10);
    const servidor = http.createServer((req, res) => {
      void withDbTrace(res, req.headers["x-db-trace"] !== undefined, async () => {
        await gate.wait();
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const porta = (servidor.address() as { port: number }).port;
    const url = `http://127.0.0.1:${porta}/barreira`;

    const respostas = await Promise.all(
      Array.from({ length: 10 }, () => fetch(url, { headers: { "x-db-trace": "1" } })),
    );

    expect(gate.arrived()).toBe(10);
    const picos = respostas.map((r) => Number(/inpk=(\d+)/.exec(r.headers.get("x-db-trace") ?? "")?.[1] ?? 0));
    expect(Math.max(...picos)).toBeGreaterThanOrEqual(2);

    for (const r of respostas) await r.text();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));

    expect(await waitUntilIdle()).toBe(0);
  });

  it("requisição com erro também libera o contador", async () => {
    const antes = inFlightState().current;
    const res = await fetch(`${base}/falha`, { headers: { "x-db-trace": "1" } });
    expect(res.status).toBe(500);
    await res.text();
    expect(await waitUntilIdle()).toBe(0);
    expect(inFlightState().current).toBe(antes);
  });

  it("requisição abortada pelo cliente libera o contador (desconexão)", async () => {
    const antes = inFlightState().current;
    const controller = new AbortController();
    const entrou = new Promise<void>((resolve) => {
      onRequestStart = resolve;
    });
    const promessa = fetch(`${base}/lento-sinal`, {
      headers: { "x-db-trace": "1" },
      signal: controller.signal,
    }).catch(() => undefined);
    // Só aborta DEPOIS que o handler entrou — abort antes de o servidor
    // receber a requisição não exercita o caminho de desconexão.
    await entrou;
    expect(inFlightState().current).toBe(antes + 1);
    controller.abort();
    await promessa;
    expect(await waitUntilIdle()).toBe(0);
    expect(inFlightState().current).toBe(antes);
    onRequestStart = null;
  });

  it("requisições que terminam em ordens diferentes mantêm o pico", async () => {
    // Cada requisição dorme um tempo diferente: a última a começar é a
    // primeira a terminar. O pico tem de refletir a sobreposição, não a ordem.
    const gate = barrier(3);
    const servidor = http.createServer((req, res) => {
      void withDbTrace(res, req.headers["x-db-trace"] !== undefined, async () => {
        await gate.wait();
        const atraso = Number(new URL(req.url ?? "/", "http://x").searchParams.get("atraso") ?? "0");
        await new Promise<void>((resolve) => setTimeout(resolve, atraso));
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const porta = (servidor.address() as { port: number }).port;

    const respostas = await Promise.all([
      fetch(`http://127.0.0.1:${porta}/x?atraso=90`, { headers: { "x-db-trace": "1" } }),
      fetch(`http://127.0.0.1:${porta}/x?atraso=10`, { headers: { "x-db-trace": "1" } }),
      fetch(`http://127.0.0.1:${porta}/x?atraso=50`, { headers: { "x-db-trace": "1" } }),
    ]);

    const picos = respostas.map((r) => Number(/inpk=(\d+)/.exec(r.headers.get("x-db-trace") ?? "")?.[1] ?? 0));
    expect(Math.max(...picos)).toBeGreaterThanOrEqual(2);

    for (const r of respostas) await r.text();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));

    expect(await waitUntilIdle()).toBe(0);
  });

  it("o fechamento é idempotente: finish + close + finally não decrementam duas vezes", async () => {
    // `exitRequest` com o mesmo token duas vezes tem de ser no-op.
    const token = enterRequestForTest();
    expect(inFlightState().current).toBeGreaterThanOrEqual(1);
    expect(exitRequestForTest(token)).toBe(true);
    const apos = inFlightState().current;
    expect(exitRequestForTest(token)).toBe(false);
    expect(inFlightState().current).toBe(apos);
  });
});

/** Helpers para testar a idempotência do token diretamente. */
import { enterRequest, exitRequest } from "./db-trace.js";
function enterRequestForTest() {
  return enterRequest();
}
function exitRequestForTest(token: ReturnType<typeof enterRequest>) {
  return exitRequest(token);
}
