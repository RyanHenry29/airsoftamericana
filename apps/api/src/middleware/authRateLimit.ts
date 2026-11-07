// language: TS, file: apps/api/src/middleware/authRateLimit.ts, target: Fastify 5
/**
 * Limite de tentativas nos endpoints de acesso do cliente.
 *
 * Regras fixas (SKILL → skill-26 "Rate Limiting"):
 *   login    → 5 tentativas por minuto; bloqueio de 15 minutos
 *   cadastro → 3 tentativas por hora; bloqueio de 24 horas
 *
 * A resposta é 429 com header `retry-after` e mensagem que diz o que fazer
 * — o front usa esse tempo para escrever a orientação na tela.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";

type Bucket = {
  hits: number;
  windowEndsAt: number;
  blockedUntil: number;
};

const buckets = new Map<string, Bucket>();

export interface AuthRateLimitRule {
  /** Namespace do limite — mantém login e cadastro em baldes separados. */
  scope: string;
  /** Tentativas permitidas dentro da janela. */
  max: number;
  /** Tamanho da janela em milissegundos. */
  windowMs: number;
  /** Duração do bloqueio quando a janela estoura, em milissegundos. */
  blockMs: number;
  /** Mensagem que o cliente lê — diz o que aconteceu e o que fazer. */
  message: string;
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.blockedUntil <= now && bucket.windowEndsAt <= now) {
      buckets.delete(key);
    }
  }
}

const pruneTimer = setInterval(() => prune(Date.now()), 60_000);
pruneTimer.unref?.();

export function authRateLimit(rule: AuthRateLimitRule) {
  return async function limit(request: FastifyRequest, reply: FastifyReply) {
    const now = Date.now();
    const key = `${rule.scope}:${request.ip}`;
    const bucket = buckets.get(key) ?? {
      hits: 0,
      windowEndsAt: now + rule.windowMs,
      blockedUntil: 0,
    };

    if (now < bucket.blockedUntil) {
      const retryAfterSeconds = Math.ceil((bucket.blockedUntil - now) / 1000);
      reply.header("retry-after", String(retryAfterSeconds));
      return reply.status(429).send({
        error: {
          code: "rate_limited",
          message: rule.message,
          details: { retryAfterSeconds },
        },
      });
    }

    if (now >= bucket.windowEndsAt) {
      bucket.hits = 0;
      bucket.windowEndsAt = now + rule.windowMs;
    }

    bucket.hits += 1;
    buckets.set(key, bucket);

    if (bucket.hits > rule.max) {
      bucket.blockedUntil = now + rule.blockMs;
      bucket.hits = 0;
      bucket.windowEndsAt = bucket.blockedUntil + rule.windowMs;

      const retryAfterSeconds = Math.ceil(rule.blockMs / 1000);
      reply.header("retry-after", String(retryAfterSeconds));
      return reply.status(429).send({
        error: {
          code: "rate_limited",
          message: rule.message,
          details: { retryAfterSeconds },
        },
      });
    }
  };
}

/** "15 min" / "24 h" — o texto da tela acompanha o bloqueio configurado. */
export function humanizeWait(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))} s`;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `${hours} h`;
}

/**
 * Regras montadas a partir do ambiente — o padrão é o do SKILL, mas dá para
 * afrouxar em desenvolvimento sem mexer no código.
 */
export function loginRateLimitRule(config: Config): AuthRateLimitRule {
  return {
    scope: "auth.login",
    max: config.AUTH_LOGIN_MAX,
    windowMs: config.AUTH_LOGIN_WINDOW_MS,
    blockMs: config.AUTH_LOGIN_BLOCK_MS,
    message: `Muitas tentativas de acesso em pouco tempo. Espera ${humanizeWait(config.AUTH_LOGIN_BLOCK_MS)} antes de tentar de novo.`,
  };
}

export function registerRateLimitRule(config: Config): AuthRateLimitRule {
  return {
    scope: "auth.register",
    max: config.AUTH_REGISTER_MAX,
    windowMs: config.AUTH_REGISTER_WINDOW_MS,
    blockMs: config.AUTH_REGISTER_BLOCK_MS,
    message: `Já criamos conta nesse e-mail mais de uma vez. Espera ${humanizeWait(config.AUTH_REGISTER_BLOCK_MS)} antes de tentar de novo.`,
  };
}

/**
 * Login do painel. Escopo próprio: as tentativas no admin não competem com
 * o balde do cliente nem com a guarda global de requisições.
 */
export function adminLoginRateLimitRule(config: Config): AuthRateLimitRule {
  return {
    scope: "auth.admin",
    max: config.AUTH_ADMIN_MAX,
    windowMs: config.AUTH_ADMIN_WINDOW_MS,
    blockMs: config.AUTH_ADMIN_BLOCK_MS,
    message: `Muitas tentativas de acesso ao painel. Espera ${humanizeWait(config.AUTH_ADMIN_BLOCK_MS)} antes de tentar de novo.`,
  };
}
