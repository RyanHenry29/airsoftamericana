// language: TS, file: apps/api/src/db/seed-target.ts, target: Node CLI
/**
 * Guarda de alvo dos seeds automatizados.
 *
 * Regras (checklist operacional, fase de seeds):
 *  - Seed NUNCA roda com NODE_ENV=production.
 *  - Seed automatizado usa PGlite local (sem DATABASE_URL) ou, no máximo, um
 *    Postgres LOCAL de desenvolvimento. Qualquer host remoto (staging,
 *    produção, RDS, Neon, Supabase...) exige opt-in explícito:
 *    SEED_ALLOW_REMOTE=1.
 *  - Seed de E2E é PGlite exclusivo (PGLITE_DIR dedicado) — nunca Postgres.
 *
 * A função é pura: recebe o ambiente e devolve/erra. Quem chama decide o
 * exit code; o teste cobre só a decisão.
 */

export class SeedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedTargetError";
  }
}

export interface SeedTarget {
  /** NODE_ENV do processo (development | test | production). */
  nodeEnv: string;
  /** DATABASE_URL configurada (vazio = PGlite local). */
  databaseUrl: string;
  /** Opt-in explícito para banco remoto: SEED_ALLOW_REMOTE=1. */
  allowRemote?: boolean;
  /** Exige PGlite (E2E): recusa qualquer DATABASE_URL. */
  requirePglite?: boolean;
}

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "host.docker.internal",
]);

/** Host do Postgres de uma connection string (null = sem DATABASE_URL). */
export function databaseHost(databaseUrl: string): string | null {
  const trimmed = (databaseUrl ?? "").trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.hostname.toLowerCase();
  } catch {
    // URL não parseável: trata como host remoto — a guarda exige opt-in.
    return "invalid-url";
  }
}

export function isLocalDatabaseHost(host: string | null): boolean {
  if (!host) return true; // sem DATABASE_URL → PGlite local
  return LOCAL_HOSTS.has(host);
}

/**
 * Valida o alvo do seed. Lança SeedTargetError com a instrução de correção.
 */
export function assertSeedTargetAllowed(target: SeedTarget): void {
  const env = (target.nodeEnv ?? "").trim().toLowerCase();

  if (env === "production") {
    throw new SeedTargetError(
      "Seed recusado em produção (NODE_ENV=production). " +
        "Em produção não se semeia: o schema é aplicado pelo bootstrap autorizado " +
        "(npm run db:bootstrap) e o catálogo real entra por importação no painel.",
    );
  }

  const host = databaseHost(target.databaseUrl);

  if (target.requirePglite) {
    if (host) {
      throw new SeedTargetError(
        `Seed de E2E recusado: DATABASE_URL aponta para ${host}. ` +
          "O seed de E2E usa PGlite exclusivo — rode com DATABASE_URL vazio e " +
          "PGLITE_DIR apontando para um diretório dedicado.",
      );
    }
    return;
  }

  if (host && !isLocalDatabaseHost(host) && target.allowRemote !== true) {
    throw new SeedTargetError(
      `Seed recusado: DATABASE_URL aponta para ${host} (banco remoto). ` +
        "Seeds automatizados rodam em PGlite ou Postgres local de desenvolvimento. " +
        "Para um banco remoto, a operação é manual e identificada: defina " +
        "SEED_ALLOW_REMOTE=1 explicitamente.",
    );
  }
}
