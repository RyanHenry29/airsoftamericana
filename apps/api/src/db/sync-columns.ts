// language: TS, file: apps/api/src/db/sync-columns.ts, target: PGlite/Postgres
/**
 * Reconcilia o banco com o schema do Drizzle.
 *
 * Por que existe: o migrate.ts cria tabelas com CREATE TABLE IF NOT EXISTS.
 * Isso cria a tabela quando falta — mas NÃO adiciona coluna em tabela que já
 * existe. Quando o schema ganha coluna nova (o outro está sempre mudando),
 * o banco fica velho e as queries caem com "column ... does not exist",
 * derrubando o painel admin inteiro.
 *
 * Este passo lê o schema (fonte da verdade) e roda
 * ALTER TABLE ... ADD COLUMN IF NOT EXISTS para tudo que faltar no banco.
 * Idempotente: rodar de novo não altera nada.
 */
import { sql } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "./index.js";
import * as schema from "./schema.js";

export type ColumnDiff = {
  table: string;
  column: string;
  sqlType: string;
  notNull: boolean;
  defaultSql: string | null;
};

export type TableDiff = {
  missingColumns: ColumnDiff[];
  extraColumns: { table: string; column: string }[];
};

type DbColumn = {
  table_name: string;
  column_name: string;
  is_nullable: string;
  column_default: string | null;
};

function isTable(value: unknown): value is PgTable {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { getTableName?: unknown; columns?: unknown };
  return typeof candidate.getTableName === "function";
}

/** Valor padrão literal da coluna (ou null quando não dá para embutir em DDL). */
function defaultLiteral(column: {
  default?: unknown;
  defaultFn?: unknown;
}): string | null {
  const source = column.defaultFn ?? column.default;
  if (source === undefined || source === null) return null;
  if (typeof source === "string") return `'${source.replace(/'/g, "''")}'`;
  if (typeof source === "number" || typeof source === "boolean") return String(source);

  // SQL do Drizzle: gera a query com o dialeto Postgres para extrair o literal.
  try {
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(source as never);
    if (query.params.length > 0) return null;
    return query.sql;
  } catch {
    return null;
  }
}

/** Fallback para coluna NOT NULL sem default: valor neutro por tipo. */
function neutralValue(sqlType: string): string | null {
  if (sqlType.startsWith("uuid")) return "gen_random_uuid()";
  if (sqlType.startsWith("timestamp")) return "now()";
  if (sqlType.startsWith("boolean")) return "false";
  if (sqlType.startsWith("integer") || sqlType.startsWith("bigint") || sqlType.startsWith("smallint")) return "0";
  if (sqlType.startsWith("numeric")) return "0";
  if (sqlType.startsWith("jsonb") || sqlType.startsWith("json")) return "'{}'::jsonb";
  if (sqlType.startsWith("text") || sqlType.startsWith("varchar")) return "''";
  return null;
}

export async function diffSchema(db: Db): Promise<TableDiff> {
  const result = (await db.execute(sql`
    SELECT table_name, column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `)) as unknown as DbColumn[] | { rows?: DbColumn[] };

  // PGlite devolve { rows }, node-postgres devolve QueryResult com .rows.
  const rows = Array.isArray(result) ? result : (result.rows ?? []);

  const existing = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = existing.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    existing.set(row.table_name, set);
  }

  const missingColumns: ColumnDiff[] = [];
  const extraColumns: { table: string; column: string }[] = [];

  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const config = getTableConfig(value);
    if (!config.columns.length) continue;

    const tableName = config.name;
    const tableColumns = existing.get(tableName) ?? new Set<string>();

    for (const column of config.columns) {
      if (tableColumns.has(column.name)) continue;
      missingColumns.push({
        table: tableName,
        column: column.name,
        sqlType: column.getSQLType(),
        notNull: column.notNull === true,
        defaultSql: defaultLiteral(column as never),
      });
    }
  }

  const known = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const config = getTableConfig(value);
    known.set(config.name, new Set(config.columns.map((c) => c.name)));
  }
  for (const [tableName, columns] of existing) {
    const expected = known.get(tableName);
    if (!expected) continue;
    for (const column of columns) {
      if (!expected.has(column)) extraColumns.push({ table: tableName, column });
    }
  }

  return { missingColumns, extraColumns };
}

/** Aplica as colunas que faltam. Idempotente. Retorna o que foi aplicado. */
export async function syncSchemaColumns(db: Db): Promise<string[]> {
  const diff = await diffSchema(db);
  const applied: string[] = [];

  for (const column of diff.missingColumns) {
    let definition = `"${column.column}" ${column.sqlType}`;
    if (column.defaultSql) definition += ` DEFAULT ${column.defaultSql}`;

    await db.execute(
      sql.raw(`ALTER TABLE "${column.table}" ADD COLUMN IF NOT EXISTS ${definition}`),
    );
    applied.push(`${column.table}.${column.column} ${column.sqlType}`);

    if (column.notNull && !column.defaultSql) {
      const neutral = neutralValue(column.sqlType);
      if (neutral) {
        await db.execute(
          sql.raw(
            `UPDATE "${column.table}" SET "${column.column}" = ${neutral} WHERE "${column.column}" IS NULL`,
          ),
        );
      }
      await db.execute(
        sql.raw(
          `ALTER TABLE "${column.table}" ALTER COLUMN "${column.column}" SET NOT NULL`,
        ),
      );
    }
  }

  return applied;
}
