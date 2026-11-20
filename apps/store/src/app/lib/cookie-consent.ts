// language: TS, file: apps/store/src/app/lib/cookie-consent.ts, target: Next.js App Router
// Constantes do aviso de cookies. Fica num módulo neutro (sem "use client")
// porque o layout (servidor) precisa do valor literal da classe e da chave
// para montar o script inline que roda antes da primeira pintura.

/** Chave do aviso de cookies (localStorage + cookie de 1 ano). */
export const COOKIE_CONSENT_KEY = "aa_cookie_consent_v1";

/** Classe no <html> que esconde o aviso antes da primeira pintura. */
export const COOKIE_DISMISSED_CLASS = "aa-cookie-dismissed";

/** Rodapé → "Preferências de cookies" reabre o aviso para quem já escolheu. */
export const COOKIE_PREFS_EVENT = "aa:cookie-prefs";

export type CookieChoice = "accepted" | "rejected";
