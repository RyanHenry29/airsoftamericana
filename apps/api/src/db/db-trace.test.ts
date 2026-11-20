// language: TS, file: apps/api/src/db/db-trace.test.ts, target: vitest
// Instrumentação por requisição: a evidência precisa sair na resposta — também
// na resposta de erro — e cada requisição precisa do próprio acumulador.
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  newTrace,
  noteAcquire,
  noteAttempt,
  noteQuery,
  noteRetry,
  traceHeader,
  traceServerTiming,
  withDbTrace,
} from "./db-trace.js";

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void withDbTrace(res, req.headers["x-db-trace"] !== undefined, async () => {
      const url = req.url ?? "/";
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

describe("formato do cabeçalho", () => {
  it("separa aquisição de execução SQL", () => {
    const trace = newTrace();
    trace.attempts = 2;
    trace.acquireMs = 1_400;
    trace.queryMs = 1_900;
    expect(traceHeader(trace)).toBe("total=1900;acq=1400;sql=500;att=2;retry=0;acqto=0;emax=0;est=0;bstop=0");
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
    expect(res.headers.get("x-db-trace")).toBe("total=180;acq=30;sql=150;att=1;retry=0;acqto=0;emax=0;est=0;bstop=0");
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
