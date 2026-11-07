import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { and, count, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";

export interface AuditEntry {
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  correlationId?: string | null;
}

/** Append-only: nunca UPDATE, nunca DELETE. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: entry.actorUserId ?? null,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    beforeJson: entry.before ? JSON.stringify(entry.before) : null,
    afterJson: entry.after ? JSON.stringify(entry.after) : null,
    ip: entry.ip ?? null,
    correlationId: entry.correlationId ?? null,
    createdAt: new Date(),
  });
}

export interface AuditListQuery {
  /** Entidade auditada (ex.: "orders", "users"). */
  entity?: string;
  /** Id da entidade auditada. */
  entityId?: string;
  /** Usuário que executou a ação. */
  actorUserId?: string;
  /** Rótulo textual do autor (e-mail mascarado, "system"). */
  actorLabel?: string;
  /** Prefixo da ação (ex.: "auth."). */
  action?: string;
  /** Início do período (inclusive). */
  from?: Date;
  /** Fim do período (exclusive). */
  to?: Date;
  /** Cursor da página anterior (opaco, devolvido em nextCursor). */
  cursor?: string;
  /** Tamanho da página. */
  limit?: number;
}

export interface AuditListResult {
  items: (typeof schema.auditLogs.$inferSelect)[];
  /** Total de registros que atendem ao filtro (contagem no banco). */
  total: number;
  limit: number;
  /** Cursor da próxima página — null quando não há mais. */
  nextCursor: string | null;
}

type AuditCursor = { createdAt: Date; id: string };

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

/** Cursor inválido é ignorado — a listagem volta para a primeira página. */
export function decodeCursor(cursor: string | undefined): AuditCursor | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    if (separator <= 0) return null;
    const createdAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Consulta da auditoria.
 *
 * Ordem decrescente (mais recente primeiro), paginação por cursor — não por
 * offset, que pule registros quando houver inserção durante a navegação — e
 * contagem feita no banco (`count(*)`), sem carregar a tabela inteira.
 */
export async function listAudit(db: Db, query: AuditListQuery = {}): Promise<AuditListResult> {
  const limit = Math.min(500, Math.max(1, query.limit ?? 50));

  const conditions: SQL[] = [];
  if (query.entity) conditions.push(eq(schema.auditLogs.entity, query.entity));
  if (query.entityId) conditions.push(eq(schema.auditLogs.entityId, query.entityId));
  if (query.actorUserId) conditions.push(eq(schema.auditLogs.actorUserId, query.actorUserId));
  if (query.actorLabel) conditions.push(eq(schema.auditLogs.actorLabel, query.actorLabel));
  if (query.action) conditions.push(sql`${schema.auditLogs.action} LIKE ${`${query.action}%`}`);
  if (query.from) conditions.push(gte(schema.auditLogs.createdAt, query.from));
  if (query.to) conditions.push(lt(schema.auditLogs.createdAt, query.to));

  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    conditions.push(
      or(
        lt(schema.auditLogs.createdAt, cursor.createdAt),
        and(eq(schema.auditLogs.createdAt, cursor.createdAt), lt(schema.auditLogs.id, cursor.id)),
      )!,
    );
  }

  const where = and(...conditions);

  const rows = await db
    .select()
    .from(schema.auditLogs)
    .where(where)
    .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
    .limit(limit);

  const counted = await db
    .select({ value: count() })
    .from(schema.auditLogs)
    .where(where);

  const total = Number(counted[0]?.value ?? 0);
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? encodeCursor(last) : null;

  return { items: rows, total, limit, nextCursor };
}

export type AuditPrivilegeCheck = (db: Db) => Promise<{ canUpdate: boolean; canDelete: boolean }>;

export async function checkAuditLogsPrivileges(db: Db): Promise<{ canUpdate: boolean; canDelete: boolean }> {
  try {
    const res: any = await db.execute(sql`SELECT has_table_privilege(current_user, 'audit_logs', 'UPDATE') AS can_update, has_table_privilege(current_user, 'audit_logs', 'DELETE') AS can_delete`);
    const row = (res?.rows ?? res)?.[0] ?? {};
    const canUpdate = row.can_update === true || row.can_update === "t" || row.can_update === 1;
    const canDelete = row.can_delete === true || row.can_delete === "t" || row.can_delete === 1;
    return { canUpdate, canDelete };
  } catch {
    // PGlite/ambientes sem has_table_privilege: não aferível por privilégio;
    // o trigger BEFORE UPDATE/DELETE continua protegendo em nível de operação.
    return { canUpdate: false, canDelete: false };
  }
}

/** Em produção, recusa subir se o usuário DB consegue UPDATE/DELETE em audit_logs. */
export async function assertAuditLogsAppendOnly(
  db: Db,
  nodeEnv: string,
  check: AuditPrivilegeCheck = checkAuditLogsPrivileges,
): Promise<void> {
  if (nodeEnv !== "production") return;
  const { canUpdate, canDelete } = await check(db);
  if (canUpdate || canDelete) {
    throw new Error(
      "Refusing to start in production: database user has UPDATE/DELETE privileges on audit_logs (append-only). Use a least-privilege DB role.",
    );
  }
}
