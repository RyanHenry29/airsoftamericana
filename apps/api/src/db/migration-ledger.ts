// language: TS, file: apps/api/src/db/migration-ledger.ts
// AUD-03: coordenação de migrations entre instâncias.
//
// - Ledger: `migration_ledger` registra cada passo (nome único, checksum,
//   status, instância, duração, erro).
// - Checksum: sha256 sobre o conteúdo do passo (statements, revision, run) —
//   divergência entre código e ledger REFUSA o boot (tamper-evident).
// - Coordenação: pg_try_advisory_lock com polling e deadline — duas instâncias
//   subindo em paralelo executam as migrations em série, nunca intercaladas.
// - Recuperação: passo marcado in_progress/interrrompida por um run anterior
//   é re-executado (DDL idempotente) e registra a recuperação; passo marcado
//   nonIdempotent REFUSA re-execução automática (decisão humana).
// - Atomicidade: DDL do passo e a marcação "aplicada" estão na MESMA
//   transação — crash no meio = rollback completo + linha in_progress
//   sobrevivente (visível para o próximo boot).
//
// Compatível com Postgres e PGlite. No Postgres, todo o run usa uma sessão
// dedicada (cliente exclusivo do pool): o advisory lock é por SESSÃO —
// executá-lo no pool genérico não serializaria nada.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { getMigrationSession, poolInstanceExists } from "./index.js";

export interface MigrationStepBase {
  name: string;
  description?: string;
  /** Recusa re-execução automática quando há run anterior não concluído. */
  nonIdempotent?: boolean;
}

export type SqlMigrationStep = MigrationStepBase & {
  /** SQL idempotente do passo (executado em transação única). */
  statements: string[];
  run?: never;
  revision?: never;
};

export type CodeMigrationStep = MigrationStepBase & {
  statements?: never;
  /** Passo de código: revisão explícita (sha256 do módulo) OBRIGATÓRIA. */
  run: (db: Db) => Promise<void>;
  revision: string;
};

export type MigrationStep = SqlMigrationStep | CodeMigrationStep;

export type MigrationStepStatus = "aplicada" | "in_progress" | "interrrompida";

export interface MigrationRunSummary {
  applied: string[];
  skipped: string[];
  recovered: string[];
  durationMs: number;
}

export interface MigrationRunnerOptions {
  /** Deadline de espera pelo advisory lock. Padrão: 120s. */
  lockTimeoutMs?: number;
}

export class MigrationChecksumError extends Error {
  constructor(
    public readonly stepName: string,
    public readonly ledgerChecksum: string,
    public readonly codeChecksum: string,
  ) {
    super(
      `checksum do passo de migração '${stepName}' diverge do ledger ` +
        `(ledger=${ledgerChecksum.slice(0, 12)}, código=${codeChecksum.slice(0, 12)}). ` +
        "O código de migração foi alterado após a aplicação — revise e decida " +
        "conscientemente (bump de revisão ou correção do ledger sob controle).",
    );
    this.name = "MigrationChecksumError";
  }
}

export class MigrationLockTimeoutError extends Error {
  constructor(public readonly lockTimeoutMs: number) {
    super(
      `outro processo mantém o advisory lock de migrations (${lockTimeoutMs}ms de espera). ` +
        "Outra instância está aplicando o schema agora; se isso persistir, investigue o holder.",
    );
    this.name = "MigrationLockTimeoutError";
  }
}

export class MigrationNonIdempotentError extends Error {
  constructor(public readonly stepName: string, public readonly priorStatus: string) {
    super(
      `passo non-idempotente '${stepName}' ficou '${priorStatus}' em um run anterior ` +
        "e não pode ser re-executado automaticamente — resolução manual obrigatória.",
    );
    this.name = "MigrationNonIdempotentError";
  }
}

/** Chave do advisory lock dedicado às migrations (número fixo do projeto). */
export const MIGRATION_LOCK_KEY = 723401723;

export function computeStepChecksum(step: MigrationStep): string {
  const payload = JSON.stringify({
    name: step.name,
    revision: step.revision ?? null,
    statements: step.statements ?? null,
    runSource: step.run?.toString() ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

interface LedgerRow {
  status: MigrationStepStatus;
  checksum: string;
  error: string | null;
}

async function rawRows(db: Db, query: Parameters<Db["execute"]>[0]): Promise<Array<Record<string, unknown>>> {
  const result = (await db.execute(query)) as unknown as { rows?: Array<Record<string, unknown>> };
  return result.rows ?? [];
}

function truncateError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 2000);
}

/** Cria a tabela do ledger (idempotente). Só é chamada sob advisory lock. */
async function ensureLedgerTable(db: Db): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "migration_ledger" (
      "step_name" varchar(120) PRIMARY KEY,
      "checksum" varchar(64) NOT NULL,
      "status" varchar(16) NOT NULL CHECK ("status" IN ('aplicada', 'in_progress', 'interrrompida')),
      "started_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "finished_at" timestamptz,
      "duration_ms" integer,
      "instance_id" text,
      "error" text
    );
  `);
}

/**
 * Roda os passos em série, sob advisory lock, com ledger/checksum/recuperação.
 * Sessão dedicada: no Postgres, um cliente exclusivo do pool segura o lock E
 * executa todo o DDL — instância B que sobe em paralelo espera e depois só
 * lê o ledger (todos os passos 'aplicada').
 */
/**
 * Mutex em-processo: dois runs no MESMO processo executam em série. Sem isso,
 * no PGlite (sessão única) o advisory lock é reentrante e dois runs
 * concorrentes aplicariam o mesmo passo duas vezes. Entre PROCESSOS (multi-
 * instância), quem coordena é o advisory lock no banco.
 */
let migrationChain: Promise<unknown> = Promise.resolve();

export async function runMigrationSteps(
  db: Db,
  steps: MigrationStep[],
  options: MigrationRunnerOptions = {},
): Promise<MigrationRunSummary> {
  const run = () => runMigrationStepsExclusive(db, steps, options);
  const result = migrationChain.then(run, run);
  migrationChain = result.catch(() => undefined);
  return result;
}

async function runMigrationStepsExclusive(
  db: Db,
  steps: MigrationStep[],
  options: MigrationRunnerOptions = {},
): Promise<MigrationRunSummary> {
  const start = performance.now();
  const summary: MigrationRunSummary = { applied: [], skipped: [], recovered: [], durationMs: 0 };
  const lockTimeoutMs = options.lockTimeoutMs ?? 120_000;
  const instanceId = `${process.pid}:${Date.now().toString(36)}`.slice(0, 60);

  // Sessão dedicada: obrigatória para Postgres (pool). PGlite usa o db do chamador.
  // NÃO há fallback silencioso: se pool existe mas falha ao obter conexão, propaga o erro.
  let session: { db: Db; release: (lockFailed?: boolean) => Promise<void>; lockFailed?: boolean };
  if (poolInstanceExists()) {
    session = await getMigrationSession();
  } else {
    // PGlite / db custom sem pool: usa o db do chamador — tx-aware.
    session = { db, release: async () => {} };
  }

  let hasOriginalError = false;
  let originalError: unknown;
  try {
    await acquireAdvisoryLock(session.db, lockTimeoutMs);
    await ensureLedgerTable(session.db);
    await executeSteps(session.db, steps, instanceId, summary);
  } catch (error) {
    hasOriginalError = true;
    originalError = error;
    throw error;
  } finally {
    const lockOk = await releaseAdvisoryLock(session.db);
    if (!lockOk) {
      session.lockFailed = true;
    }
    try {
      await session.release(session.lockFailed);
    } catch (cleanupError) {
      if (hasOriginalError) {
        console.error("migration cleanup failed:", cleanupError);
      } else {
        throw cleanupError;
      }
    }
  }

  summary.durationMs = Math.round(performance.now() - start);
  return summary;
}

async function acquireAdvisoryLock(db: Db, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await rawRows(db, sql`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS ok`);
    if (rows[0]?.ok === true) return;
    if (Date.now() > deadline) throw new MigrationLockTimeoutError(timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/**
 * Libera o advisory lock. Retorna true se conseguiu confirmar o unlock.
 * Se falhar OU o PostgreSQL retornar false (sessão não detinha o lock),
 * NÃO devolve a conexão ao pool (o caller deve descartar).
 */
async function releaseAdvisoryLock(db: Db): Promise<boolean> {
  try {
    const rows = await rawRows(
      db,
      sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}) AS unlocked`,
    );
    return rows[0]?.unlocked === true;
  } catch {
    return false;
  }
}

async function executeSteps(
  sessionDb: Db,
  steps: MigrationStep[],
  instanceId: string,
  summary: MigrationRunSummary,
): Promise<void> {
  for (const step of steps) {
    const checksum = computeStepChecksum(step);
    const rows = await rawRows(
      sessionDb,
      sql`SELECT "status", "checksum", "error" FROM "migration_ledger" WHERE "step_name" = ${step.name}`,
    );
    const existing = rows[0] as LedgerRow | undefined;

    if (existing?.status === "aplicada") {
      if (existing.checksum !== checksum) {
        throw new MigrationChecksumError(step.name, existing.checksum, checksum);
      }
      summary.skipped.push(step.name);
      continue;
    }

    // VALIDAÇÃO DE CHECKSUM ANTES DA RECUPERAÇÃO:
    // Se há registro anterior (in_progress ou interrrompida) com checksum divergente,
    // RECUSA a recuperação automática — exige intervenção humana.
    if (existing && existing.checksum !== checksum) {
      throw new MigrationChecksumError(step.name, existing.checksum, checksum);
    }

    if (existing && step.nonIdempotent) {
      throw new MigrationNonIdempotentError(step.name, existing.status);
    }

    if (existing) {
      // Recuperação: run anterior morreu no meio deste passo. DDL idempotente
      // torna a re-execução segura; a trilha do erro anterior sobrevive no
      // upsert abaixo (recuperado em novo run) para observabilidade.
      summary.recovered.push(step.name);
    }

    const stepStart = performance.now();
    try {
      // Marca in_progress (transação própria, commitado ANTES do DDL): um
      // crash no meio do DDL deixa a linha visível para o próximo boot.
      await sessionDb.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO "migration_ledger" ("step_name", "checksum", "status", "instance_id")
          VALUES (${step.name}, ${checksum}, 'in_progress', ${instanceId})
          ON CONFLICT ("step_name") DO UPDATE
          SET "checksum" = EXCLUDED."checksum", "status" = 'in_progress',
              "instance_id" = EXCLUDED."instance_id", "started_at" = clock_timestamp(),
              "error" = CASE WHEN "migration_ledger"."error" IS NOT NULL
                             THEN "migration_ledger"."error" || ' | recuperado em novo run'
                             ELSE NULL END
        `);
      });

      // DDL do passo + marcação "aplicada" na MESMA transação: atômico.
      // O campo "error" é PRESERVADO: traz a trilha de recuperação anotada
      // antes do run (success fresh mantém NULL, recuperado mantém a nota).
      await sessionDb.transaction(async (tx) => {
        if (step.run) {
          await step.run(tx as unknown as Db);
        } else {
          for (const statement of step.statements ?? []) {
            await tx.execute(sql.raw(statement));
          }
        }
        await tx.execute(sql`
          UPDATE "migration_ledger"
          SET "status" = 'aplicada', "checksum" = ${checksum},
              "finished_at" = clock_timestamp(), "duration_ms" = ${Math.round(performance.now() - stepStart)}
          WHERE "step_name" = ${step.name}
        `);
      });

      summary.applied.push(step.name);
    } catch (error) {
      // Falha real (não crash): registra 'interrrompida' com o erro e propaga.
      try {
        await sessionDb.execute(sql`
          UPDATE "migration_ledger"
          SET "status" = 'interrrompida', "error" = ${truncateError(error)}
          WHERE "step_name" = ${step.name}
        `);
      } catch {
        // erro secundário não mascara o primário
      }
      throw error;
    }
  }
}