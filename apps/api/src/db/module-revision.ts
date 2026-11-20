// language: TS, file: apps/api/src/db/module-revision.ts, target: node
/**
 * Fingerprint canônico de um módulo de migração.
 *
 * O sha256 dos bytes CRU dependia da quebra de linha da CÓPIA DE TRABALHO:
 * o mesmo arquivo é LF no checkout do Linux (CI, Vercel) e CRLF no Windows
 * com core.autocrlf=true. A revisão saía diferente em cada plataforma — o
 * ledger recusava o bootstrap de um banco migrado em outra máquina
 * (MigrationChecksumError) e o CI quebrava no fingerprint.
 *
 * Canonicalização: CRLF e CR viram LF antes do hash. O conteúdo lógico é
 * idêntico nas duas plataformas, então a revisão passa a ser a mesma.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Normaliza quebras de linha: CRLF e CR -> LF. */
export function canonicalizeSource(source: string | Buffer): string {
  return source.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Revisão canônica (prefixo + 32 hex) a partir do conteúdo do módulo. */
export function moduleRevisionFromSource(source: string | Buffer): string {
  const canonical = canonicalizeSource(source);
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)}`;
}

/** Revisão canônica a partir do arquivo do módulo. */
export function moduleRevisionFromFile(filePath: string): string {
  return moduleRevisionFromSource(readFileSync(filePath));
}

/**
 * Revisão no formato CRU (LF forçado para CRLF) — usada só para detectar
 * ledgers gravados por um código que hasheava bytes sem canonicalizar.
 */
export function moduleRevisionFromSourceAsCrlf(source: string | Buffer): string {
  const crlf = canonicalizeSource(source).replace(/\n/g, "\r\n");
  return `sha256:${createHash("sha256").update(crlf, "utf8").digest("hex").slice(0, 32)}`;
}
