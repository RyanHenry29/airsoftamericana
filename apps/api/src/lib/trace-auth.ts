// language: TS, file: apps/api/src/lib/trace-auth.ts, target: Node 22 + Vercel Node Function
/**
 * Autorização da telemetria detalhada do pool (`x-db-trace`).
 *
 * PROBLEMA QUE ESTE MÓDULO RESOLVE
 * ---------------------------------
 * O header `x-db-trace` é um sinal de ATIVAÇÃO, não de AUTORIZAÇÃO. Qualquer
 * cliente que conheça o endpoint podia enviar `x-db-trace: 1` e ler:
 *   - `inst`  identificador da instância (revela quantas instâncias e como
 *              o tráfego foi distribuído pela Vercel);
 *   - `pmax`  limite de conexões do pool (revela o dimensionamento);
 *   - `ctmo`  timeout de aquisição (revela a tolerância a filas);
 *   - `inl` / `inpk`  concorrência real do processo (revela a saturação).
 *
 * Nenhum desses é credencial, mas juntos são um mapa da infraestrutura. O
 * requisito é: healthcheck público continua 200, e métricas detalhadas exigem
 * autorização independente do header `x-db-trace`.
 *
 * DECISÃO
 * -------
 * - O token esperado vem de `DB_TRACE_TOKEN` (variável de ambiente).
 * - O cliente apresenta o token em `x-db-trace-token` ou em
 *   `Authorization: Bearer <token>`.
 * - Comparação em tempo constante (`timingSafeEqual` sobre digests SHA-256,
 *   de tamanho fixo — o caminho de execução não depende do comprimento do
 *   token apresentado).
 * - **FALHA FECHADA**: se `DB_TRACE_TOKEN` não estiver configurada, NENHUMA
 *   métrica detalhada é liberada — nem no healthz, nem no header de resposta.
 *   O healthcheck básico (`ok`, `timestamp`) continua sempre disponível.
 * - A comparação é feita por processo, com cache curto, para não pagar o
 *   custo de `timingSafeEqual` a cada request em regime de rajada. O cache é
 *   chaveado pelo PAR (token esperado, token apresentado): se o `env` muda,
 *   o cache é invalidado — um resultado antigo nunca sobrevive a uma troca
 *   de token.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Nome da variável de ambiente com o token esperado. */
export const TRACE_TOKEN_ENV = "DB_TRACE_TOKEN";

/** Header em que o cliente apresenta o token. */
export const TRACE_TOKEN_HEADER = "x-db-trace-token";

/** Cabeçalhos lidos do request (shape mínimo — `IncomingMessage` satisfaz). */
export type TraceAuthHeaders = {
  [key: string]: string | string[] | undefined;
};

/** Resultado da verificação de autorização da telemetria. */
export type TraceAuthResult = {
  /** `true` quando o caller provou posse do token. */
  allowed: boolean;
  /** Motivo — para log interno, nunca exposto ao cliente. */
  reason: "ok" | "not_configured" | "missing_token" | "invalid_token";
};

/** Cache do resultado por par (token esperado, token apresentado). */
let cachedPresented: string | null = null;
let cachedExpected: string | null = null;
let cachedResult: TraceAuthResult | null = null;

/** Limpa o cache (usado em teste). */
export function resetTraceAuthCache(): void {
  cachedPresented = null;
  cachedExpected = null;
  cachedResult = null;
}

/** Extrai o token apresentado do request (header dedicado ou Bearer). */
export function presentedToken(headers: TraceAuthHeaders): string | null {
  const dedicated = headers[TRACE_TOKEN_HEADER];
  const raw = Array.isArray(dedicated) ? dedicated[0] : dedicated;
  if (raw && raw.trim() !== "") return raw.trim();

  const authorization = headers.authorization;
  const auth = Array.isArray(authorization) ? authorization[0] : authorization;
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/**
 * Comparação em tempo constante, tolerante a comprimentos diferentes.
 *
 * Os dois tokens são reduzidos a um digest SHA-256 de tamanho fixo antes da
 * comparação: assim o `timingSafeEqual` sempre opera sobre buffers do mesmo
 * tamanho, e o caminho de execução não depende do comprimento do token
 * apresentado (o comprimento, ele próprio, é público no header).
 */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Verifica se o caller está autorizado a ler telemetria detalhada.
 *
 * Sem `DB_TRACE_TOKEN` configurada, NENHUMA telemetria detalhada é liberada.
 */
export function checkTraceAuth(headers: TraceAuthHeaders): TraceAuthResult {
  const expected = (process.env[TRACE_TOKEN_ENV] ?? "").trim();
  if (expected === "") {
    return { allowed: false, reason: "not_configured" };
  }

  const presented = presentedToken(headers);
  if (presented === null) {
    return { allowed: false, reason: "missing_token" };
  }

  if (cachedPresented === presented && cachedExpected === expected && cachedResult !== null) {
    return cachedResult;
  }

  const result: TraceAuthResult = safeEqual(presented, expected)
    ? { allowed: true, reason: "ok" }
    : { allowed: false, reason: "invalid_token" };

  cachedPresented = presented;
  cachedExpected = expected;
  cachedResult = result;
  return result;
}

/**
 * Atalho booleano. Usado nos call sites que só precisam do sim/não.
 */
export function traceAuthAllowed(headers: TraceAuthHeaders): boolean {
  return checkTraceAuth(headers).allowed;
}
