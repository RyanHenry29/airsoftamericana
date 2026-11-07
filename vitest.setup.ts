import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'aa-pglite-'));
process.env.PGLITE_TEST_DIR = dir;
afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});