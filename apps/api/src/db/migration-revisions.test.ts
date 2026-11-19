// language: TS, file: apps/api/src/db/migration-revisions.test.ts, target: vitest
/**
 * Drift das revisões dos passos de código.
 *
 * O checksum do ledger NÃO usa o source transpilado do `run` (muda entre
 * vitest/tsx/bundle da Vercel). O fingerprint do passo de código é a
 * `revision` — o sha256 do módulo. Este teste é o mecanismo que garante que
 * a revisão seja bumpeada quando o módulo muda: editar o módulo sem bump
 * quebra aqui, no CI, em vez de silenciar a detecção no ledger.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SYNC_SCHEMA_COLUMNS_REVISION,
  MIGRATE_LEGACY_ROLES_REVISION,
} from "./migrate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function moduleRevision(fileName: string): string {
  const bytes = readFileSync(path.join(HERE, fileName));
  return `sha256:${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}`;
}

describe("revisões dos passos de código (fingerprint do ledger)", () => {
  it("029_sync_schema_columns: revision = sha256 de sync-columns.ts", () => {
    expect(SYNC_SCHEMA_COLUMNS_REVISION).toBe(moduleRevision("sync-columns.ts"));
  });

  it("030_migrate_legacy_roles: revision = sha256 de migrate-roles.ts", () => {
    expect(MIGRATE_LEGACY_ROLES_REVISION).toBe(moduleRevision("migrate-roles.ts"));
  });
});
