// language: TS, file: apps/api/src/db/migration-revisions.test.ts, target: vitest
/**
 * Drift das revisões dos passos de código.
 *
 * O checksum do ledger NÃO usa o source transpilado do `run` (muda entre
 * vitest/tsx/bundle da Vercel). O fingerprint do passo de código é a
 * `revision` — o sha256 CANÔNICO do módulo (CRLF/CR normalizados para LF,
 * senão a revisão mudava entre o checkout Windows e o Linux do CI).
 * Este teste é o mecanismo que garante que a revisão seja bumpeada quando
 * o módulo muda: editar o módulo sem bump quebra aqui, no CI, em vez de
 * silenciar a detecção no ledger.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  moduleRevisionFromFile,
  moduleRevisionFromSource,
  moduleRevisionFromSourceAsCrlf,
} from "./module-revision.js";
import { MIGRATION_STEPS } from "./migrate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const codeSteps = MIGRATION_STEPS.filter(
  (step): step is typeof step & { sourceFile: string; revision: string } =>
    typeof step.run === "function" && typeof step.sourceFile === "string",
);

describe("revisões dos passos de código (fingerprint do ledger)", () => {
  it("todo passo de código declara sourceFile e revision", () => {
    expect(codeSteps.length).toBeGreaterThan(0);
    for (const step of codeSteps) {
      expect(step.revision, step.name).toMatch(/^sha256:[0-9a-f]{32}$/);
      expect(step.sourceFile, step.name).toMatch(/\.ts$/);
    }
  });

  it("revision = sha256 canônico do módulo (igual em Windows e Linux)", () => {
    for (const step of codeSteps) {
      const file = path.join(HERE, step.sourceFile);
      expect(step.revision, step.name).toBe(moduleRevisionFromFile(file));
    }
  });

  it("o fingerprint não depende da quebra de linha (CRLF e LF dá o mesmo)", () => {
    const source = readFileSync(path.join(HERE, "migrate-roles.ts"));
    const asCrlf = Buffer.from(
      source.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
      "utf8",
    );
    expect(moduleRevisionFromSource(asCrlf)).toBe(moduleRevisionFromSource(source));
    // e o hash CRU (o que causava o drift) é DIFERENTE do canônico
    expect(moduleRevisionFromSourceAsCrlf(source)).not.toBe(moduleRevisionFromSource(source));
  });
});
