// language: TS, file: apps/api/src/lib/trace-auth.test.ts, target: vitest
/**
 * Segurança da telemetria detalhada.
 *
 * O requisito é: o header `x-db-trace` ATIVA o pedido, mas NÃO AUTORIZA.
 * A autorização precisa de um token independente. E a falha é FECHADA: sem
 * `DB_TRACE_TOKEN` configurada, nenhuma métrica pode ser lida.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TRACE_TOKEN_ENV,
  TRACE_TOKEN_HEADER,
  checkTraceAuth,
  presentedToken,
  resetTraceAuthCache,
  traceAuthAllowed,
} from "./trace-auth.js";

const TOKEN = "tok-de-teste-9f3a2b";

beforeEach(() => {
  resetTraceAuthCache();
  delete process.env[TRACE_TOKEN_ENV];
});

afterEach(() => {
  delete process.env[TRACE_TOKEN_ENV];
  resetTraceAuthCache();
});

describe("presentedToken", () => {
  it("lê o header dedicado", () => {
    expect(presentedToken({ [TRACE_TOKEN_HEADER]: TOKEN })).toBe(TOKEN);
  });

  it("lê o header Authorization Bearer", () => {
    expect(presentedToken({ authorization: `Bearer ${TOKEN}` })).toBe(TOKEN);
  });

  it("ignora header vazio ou ausente", () => {
    expect(presentedToken({})).toBeNull();
    expect(presentedToken({ [TRACE_TOKEN_HEADER]: "   " })).toBeNull();
  });

  it("ignora Authorization sem Bearer", () => {
    expect(presentedToken({ authorization: TOKEN })).toBeNull();
  });
});

describe("checkTraceAuth", () => {
  it("NÃO autoriza quando o token não está configurado (falha fechada)", () => {
    const result = checkTraceAuth({ [TRACE_TOKEN_HEADER]: TOKEN });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("not_configured");
  });

  it("NÃO autoriza sem token apresentado, mesmo com DB_TRACE_TOKEN configurado", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    const result = checkTraceAuth({});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_token");
  });

  it("NÃO autoriza com token errado", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    const result = checkTraceAuth({ [TRACE_TOKEN_HEADER]: "token-errado" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("invalid_token");
  });

  it("autoriza com o token correto no header dedicado", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    const result = checkTraceAuth({ [TRACE_TOKEN_HEADER]: TOKEN });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("autoriza com o token correto no Authorization Bearer", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    expect(traceAuthAllowed({ authorization: `Bearer ${TOKEN}` })).toBe(true);
  });

  it("o resultado em cache não libera um token diferente", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: TOKEN })).toBe(true);
    // Token diferente depois do cache — tem de ser rejeitado.
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: "outro-token" })).toBe(false);
  });

  it("troca do token ESPERADO invalida o cache", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: TOKEN })).toBe(true);
    // Mesmo token apresentado, novo token esperado: o cache antigo não vale.
    process.env[TRACE_TOKEN_ENV] = "token-esperado-trocado";
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: TOKEN })).toBe(false);
    // E o novo par (esperado, apresentado) passa a ser reconhecido.
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: "token-esperado-trocado" })).toBe(true);
  });

  it("token com prefixo correto mas sufixo errado é rejeitado", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: `${TOKEN}x` })).toBe(false);
  });

  it("token de comprimento diferente é rejeitado sem lançar", () => {
    process.env[TRACE_TOKEN_ENV] = TOKEN;
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: "a" })).toBe(false);
  });

  it("o env com espaço em volta é normalizado", () => {
    process.env[TRACE_TOKEN_ENV] = `  ${TOKEN}  `;
    expect(traceAuthAllowed({ [TRACE_TOKEN_HEADER]: TOKEN })).toBe(true);
  });
});
