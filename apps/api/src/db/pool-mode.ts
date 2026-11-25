// language: TS, file: apps/api/src/db/pool-mode.ts, target: Node 22 + node-postgres
/**
 * Modo de acesso ao Postgres, derivado da URL de conexão.
 *
 * O pooler do Supabase (Supavisor) tem dois modos e eles NÃO são equivalentes:
 *
 *  - SESSION MODE (porta 5432): cada conexão do cliente é uma sessão fixa no
 *    Postgres. O pooler aceita no máximo `pool_size` clientes SIMULTÂNEOS
 *    (15 no projeto) — e o erro devolvido é
 *    `EMAXCONNSESSION: max clients reached in session mode`.
 *    Em serverless, cada instância da função abre o próprio pool: com N
 *    instâncias e `max: 5` por pool, o limite de 15 estoura em rajada — a API
 *    passa a responder 500 em tudo (medido: 38 falhas em 48 requisições).
 *
 *  - TRANSACTION MODE (porta 6543): o pooler empresta um backend do Postgres
 *    por transação e multiplexa clientes. Não há trava de clientes nem
 *    estado de sessão entre comandos — por isso serve para runtime serverless
 *    (medido: 40/40 requisições concorrentes com sucesso).
 *
 * O que o runtime NÃO pode usar em transaction mode: advisory lock de SESSÃO
 * (o backend pode trocar entre comandos e o lock se perde). Por isso o CLI de
 * migrations/bootstrap exige session mode — ver `assertSessionScopeSafe`.
 */

/** transaction = pooler em transaction mode; session = pooler em session mode; direct = Postgres direto. */
export type PoolMode = "transaction" | "session" | "direct";

/**
 * Classifica a URL de conexão. Porta 6543 é a convenção do pooler em
 * transaction mode (Supavisor/PgBouncer); host `*.pooler.supabase.com` na
 * porta 5432 é session mode; qualquer outra coisa é conexão direta.
 */
export function classifyPooler(connectionString: string): PoolMode {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return "direct";
  }
  const port = url.port || "5432";
  const host = url.hostname.toLowerCase();
  if (port === "6543") return "transaction";
  if (host.endsWith(".pooler.supabase.com")) return "session";
  return "direct";
}

export type PoolSizing = {
  /** Conexões simultâneas por instância. */
  max: number;
  /** Espera máxima por uma conexão do pool antes de desistir. */
  connectionTimeoutMillis: number;
  /**
   * Tempo que uma conexão ociosa permanece no pool antes de ser fechada.
   * Sem isso, cada instância aquecida segura uma vaga do teto global do
   * pooler (200 clientes por projeto, medido) mesmo sem receber tráfego.
   */
  idleTimeoutMillis: number;
};

/**
 * Dimensiona o pool por modo:
 *  - transaction: 1 conexão por instância (é o client máximo do pooler em
 *    transaction mode; o pooler multiplexa o resto).
 *  - session: 1 conexão por instância — no session mode cada conexão consome
 *    uma das poucas vagas globais do pooler.
 *  - direct: 5 conexões (Postgres direto não tem trava de pooler).
 *
 * O `idleTimeoutMillis` devolve a vaga ao pooler: conexão ociosa não segura
 * vaga do teto global.
 *
 * ── Benchmark de concorrência (branch experimental) ──────────────────────────
 * O gargalo da arquitetura é o par (concorrência da instância × conexões por
 * instância). Para medir cada alternativa separadamente, o dimensionamento
 * precisa ser parâmetro de DEPLOY, não constante compilada. As variáveis
 * abaixo existem para esse benchmark; o padrão é o do controle medido
 * (max 1, espera de aquisição de 10 s), que é o único que fecha 300/300 no
 * regime aquecido.
 *
 *   DB_POOL_MAX                  conexões simultâneas por instância (1–20)
 *   DB_POOL_ACQUIRE_TIMEOUT_MS   espera máxima por conexão do pool (100–120000)
 *   DB_POOL_IDLE_TIMEOUT_MS      ociosidade antes de devolver a vaga (1000–300000)
 */
export function poolSizing(mode: PoolMode): PoolSizing {
  const base =
    mode === "direct"
      ? { max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 }
      : { max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 };
  return {
    max: envInt("DB_POOL_MAX", base.max, 1, 20),
    connectionTimeoutMillis: envInt("DB_POOL_ACQUIRE_TIMEOUT_MS", base.connectionTimeoutMillis, 100, 120_000),
    idleTimeoutMillis: envInt("DB_POOL_IDLE_TIMEOUT_MS", base.idleTimeoutMillis, 1_000, 300_000),
  };
}

/** Lê inteiro do ambiente, ignorando valor inválido e restringindo ao intervalo. */
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Guard para operações que dependem de estado de SESSÃO (advisory lock de
 * sessão do ledger de migrations). Em transaction mode o backend pode trocar
 * entre comandos e o lock se perde — duas instâncias de migration poderiam
 * rodar ao mesmo tempo.
 */
export function assertSessionScopeSafe(connectionString: string, what: string): void {
  if (classifyPooler(connectionString) !== "transaction") return;
  throw new Error(
    `${what} exige conexão com lock de SESSÃO (advisory lock). ` +
      "A URL informada aponta para o pooler em transaction mode (porta 6543), " +
      "onde o backend pode trocar entre comandos e o lock se perde. " +
      "Use a URL em session mode (porta 5432) ou a conexão direta.",
  );
}
