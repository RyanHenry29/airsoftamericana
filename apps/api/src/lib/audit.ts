import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import { eq } from "drizzle-orm";

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

export async function listAudit(
  db: Db,
  opts: { entity?: string; actor?: string; page?: number; limit?: number } = {},
) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  const where = [] as ReturnType<typeof eq>[];
  if (opts.entity) where.push(eq(schema.auditLogs.entity, opts.entity));
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .orderBy(schema.auditLogs.createdAt)
    .limit(limit)
    .offset((page - 1) * limit);
  const totalRows = await db.select().from(schema.auditLogs);
  return { items: rows, total: totalRows.length, page, limit };
}