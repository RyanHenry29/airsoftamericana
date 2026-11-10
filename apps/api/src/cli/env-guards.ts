// language: TS, file: apps/api/src/cli/env-guards.ts, target: Node CLI
// Deve ser o PRIMEIRO import de qualquer CLI: `vercel env run` injeta
// NODE_ENV/COOKIE_SAMESITE como string vazia (a plataforma os define em
// runtime, não nas variáveis do projeto) e o zod do config rejeita "".
// Só roda em contexto local/CLI — nunca em runtime de servidor.
process.env.NODE_ENV ||= "development";
process.env.COOKIE_SAMESITE ||= "lax";
export {};
