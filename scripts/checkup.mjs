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

/**
 * A fact file exports `facts` (or a default), as an array or a single object.
 * Read tolerantly: a later increment drops a file in here, and a malformed
 * drop-in must be reported as a failed fact rather than crash the report and
 * hide the other facts.
 */
function factsOf(module, file) {
  const declared = module.facts ?? module.default;
  const list = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared];
  const fallbackName = file.replace(/^\d+-/, '').replace(/\.mjs$/, '');
  return list.length === 0
    ? [{ name: fallbackName, check: () => ({ ok: false, detail: `${file} exports no facts` }) }]
    : list.map((fact, index) => {
        const name = typeof fact?.name === 'string' && fact.name.length > 0 ? fact.name : `${fallbackName}-${index}`;
        if (typeof fact?.check !== 'function') {
          return { name, check: () => ({ ok: false, detail: `${file} declares no check() for this fact` }) };
        }
        return { name, check: fact.check };
      });
}

for (const file of factFiles) {
  let facts;
  try {
    const module = await import(pathToFileURL(join(factDir, file)).href);
    facts = factsOf(module, file);
  } catch (error) {
    facts = [
      {
        name: file.replace(/^\d+-/, '').replace(/\.mjs$/, ''),
        check: () => ({ ok: false, detail: `could not load ${file}: ${error instanceof Error ? error.message : String(error)}` }),
      },
    ];
  }
  for (const fact of facts) {
    let ok = false;
    let detail = '';
    try {
      const outcome = await fact.check({ repoRoot });
      ok = outcome?.ok === true;
      detail = typeof outcome?.detail === 'string' ? outcome.detail : '';
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
