// language: TS, file: apps/api/src/db/healthz-trace.test.ts, target: vitest
/**
 * Contrato do `/healthz` com telemetria — testado contra o HANDLER REAL
 * (`apps/api/index.ts`), o mesmo que a Vercel executa. Não é uma réplica da
 * wiring: se o entrypoint mudar, este teste quebra.
 *
 * Requisitos que este arquivo prova:
 *   1. o healthcheck é PÚBLICO e sempre 200 — inclusive sem banco;
 *   2. sem token, NENHUMA métrica de pool é exposta;
 *   3. com token, as métricas aparecem;
 *   4. o `x-db-trace` sozinho (sem token) NÃO abre a telemetria;
 *   5. o header `x-db-trace` de RESPOSTA também não vaza sem token;
 *   6. com o banco ainda não inicializado, o status é honesto
 *      (`db_uninitialized`) — nunca "connected" com `pmax=0`.
 */
import http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TRACE_TOKEN_ENV, TRACE_TOKEN_HEADER } from "../lib/trace-auth.js";
import { runtimePoolInfo, setDbRuntimeInfo } from "./db-trace.js";
import handler from "../../index.js";

const TOKEN = "tok-healthz-teste-7c1d";

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      if (!res.writableEnded) res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  // Banco "não inicializado": estado real de um processo que ainda não
  // abriu conexão. O healthz tem de dizer isso, e não "connected".
  setDbRuntimeInfo({ poolMax: 0, acquireTimeoutMs: 0, instanceId: "" });
  delete process.env[TRACE_TOKEN_ENV];
});

afterEach(() => {
  delete process.env[TRACE_TOKEN_ENV];
  setDbRuntimeInfo({ poolMax: 0, acquireTimeoutMs: 0, instanceId: "" });
});

describe("healthz público", () => {
  it("responde 200 sem nenhum header", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; timestamp: string; db: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.timestamp).toBeTruthy();
    expect(body.db.status).toBe("trace_not_requested");
  });

  it("responde 200 com x-db-trace mas SEM token e não expõe métricas", async () => {
    // Token CONFIGURADO no servidor, mas o caller não o apresenta:
    // o motivo é "não autorizado", não "telemetria desligada".
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    const res = await fetch(`${base}/healthz`, { headers: { "x-db-trace": "1" } });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("pmax=");
    expect(raw).not.toContain("inpk=");
    expect(raw).not.toContain("abcdef01");
    expect(JSON.parse(raw).db.status).toBe("trace_unauthorized");
  });

  it("o header de resposta x-db-trace NÃO vaza sem token", async () => {
    const res = await fetch(`${base}/healthz`, { headers: { "x-db-trace": "1" } });
    expect(res.headers.get("x-db-trace")).toBeNull();
    expect(res.headers.get("server-timing")).toBeNull();
  });

  it("responde 200 com token errado e não expõe métricas", async () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    const res = await fetch(`${base}/healthz`, {
      headers: { "x-db-trace": "1", [TRACE_TOKEN_HEADER]: "token-errado" },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("pmax=");
    expect(raw).not.toContain("abcdef01");
    expect(res.headers.get("x-db-trace")).toBeNull();
    expect(JSON.parse(raw).db.status).toBe("trace_unauthorized");
  });

  it("sem token configurado a telemetria fica DESLIGADA (falha fechada)", async () => {
    const res = await fetch(`${base}/healthz`, {
      headers: { "x-db-trace": "1", [TRACE_TOKEN_HEADER]: TOKEN },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("pmax=");
    expect(JSON.parse(raw).db.status).toBe("trace_disabled");
  });
});

describe("healthz autorizado", () => {
  it("com token correto expõe as métricas no header de resposta", async () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    setDbRuntimeInfo({ poolMax: 5, acquireTimeoutMs: 10_000, instanceId: "abcdef01" });
    const res = await fetch(`${base}/healthz`, {
      headers: { "x-db-trace": "1", [TRACE_TOKEN_HEADER]: TOKEN },
    });
    expect(res.status).toBe(200);
    const trace = res.headers.get("x-db-trace") ?? "";
    expect(trace).toContain("pmax=5");
    expect(trace).toMatch(/inl=\d+/);
    expect(trace).toMatch(/inpk=\d+/);
  });

  it("com token correto o corpo não vaza segredo do env", async () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    setDbRuntimeInfo({ poolMax: 5, acquireTimeoutMs: 10_000, instanceId: "abcdef01" });
    const res = await fetch(`${base}/healthz`, {
      headers: { "x-db-trace": "1", [TRACE_TOKEN_HEADER]: TOKEN },
    });
    const raw = await res.text();
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain("DATABASE_URL");
    expect(raw).not.toContain("postgresql://");
  });

  it("com o banco não inicializado o status é honesto (db_uninitialized)", async () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    // runtimeInfo zerado: o processo ainda não abriu o pool.
    const res = await fetch(`${base}/healthz`, {
      headers: { "x-db-trace": "1", [TRACE_TOKEN_HEADER]: TOKEN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { db: { status: string; pmax?: number; inst?: string } };
    expect(body.db.status).toBe("db_uninitialized");
    // NÃO pode afirmar "connected" nem inventar pmax=0.
    expect(body.db.status).not.toBe("connected");
    expect(body.db.pmax).toBeUndefined();
    expect(body.db.inst).toBeUndefined();
    expect(runtimePoolInfo().instanceId).toBe("");
  });
});
