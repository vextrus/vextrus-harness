#!/usr/bin/env node
/**
 * V-CHECKUP — the machine's report, run at session start.
 *
 * Facts are the files in `scripts/checkup.d/`, run in filename order. Unlike
 * V-VERIFY this is deliberately NOT fail-fast: a checkup that stops at the
 * first bad fact hides the other seven. Every fact is reported; the exit code
 * is non-zero if any of them failed.
 *
 * Report format: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const factDir = join(here, 'checkup.d');

const DASH = '—';

const factFiles = readdirSync(factDir)
  .filter((entry) => /^\d+-.*\.mjs$/.test(entry))
  .sort();

let failed = 0;

for (const file of factFiles) {
  const module = await import(pathToFileURL(join(factDir, file)).href);
  for (const fact of module.facts) {
    let ok = false;
    let detail = '';
    try {
      const outcome = await fact.check({ repoRoot });
      ok = outcome.ok === true;
      detail = outcome.detail;
    } catch (error) {
      ok = false;
      detail = `probe threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (detail.length === 0) detail = ok ? 'ok' : 'failed';
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? 'ok' : 'FAIL'} ${fact.name} ${DASH} ${detail}\n`);
  }
}

process.stdout.write(
  `\n${failed === 0 ? 'checkup: all facts ok' : `checkup: ${failed} fact(s) failed`}\n`,
);
process.exit(failed === 0 ? 0 : 1);
