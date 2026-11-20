// language: TS, file: apps/api/src/lib/error-chain.ts, target: Node 22
/**
 * Cadeia de causas de um erro, em uma linha.
 *
 * O drizzle embrulha a falha do driver em `DrizzleQueryError` ("Failed query:
 * <sql>\nparams: …") e guarda o erro original do `pg` em `cause`. Logar só a
 * mensagem externa esconde a causa — foi assim que 500 de query passaram
 *Battery sem diagnóstico. Esta função desce pela cadeia sem repetir o SQL.
 */

/** Máximo de mensagens na cadeia (evita ciclo acidental e log gigante). */
const MAX_DEPTH = 5;

/** Cada mensagem é truncada — a do drizzle carrega o SQL inteiro. */
const MAX_MESSAGE = 300;

/**
 * Descreve `error` e suas causes como "código: mensagem <- código: mensagem".
 * Sem segredos: devolve apenas texto de erro.
 */
export function describeErrorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current instanceof Error && depth < MAX_DEPTH) {
    const code = (current as { code?: unknown }).code;
    const message = current.message.length > MAX_MESSAGE
      ? `${current.message.slice(0, MAX_MESSAGE)}…`
      : current.message;
    parts.push(typeof code === "string" && code ? `${code}: ${message}` : message);
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }
  if (parts.length === 0) return String(error);
  return parts.join(" <- ");
}
