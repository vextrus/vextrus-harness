#!/usr/bin/env node
/**
 * V-CHECKUP: the machine's report, run at session start.
 *
 * Facts are files in `scripts/checkup.d/`, each exporting `checks` — a list of
 * `{ name, check }`. A later increment adds a fact by adding a file (B-03).
 *
 * Unlike verify, checkup is NOT fail-fast: a broken machine must be described
 * completely, not one symptom at a time. Every fact is reported; the exit code
 * is non-zero if any of them failed.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const FACT_DIR = path.join(ROOT, 'scripts', 'checkup.d');

const EM_DASH = '—';

function report(ok, name, detail) {
  const text = detail === undefined || detail === '' ? 'no detail' : detail;
  process.stdout.write(`${ok ? 'ok' : 'FAIL'} ${name} ${EM_DASH} ${text}\n`);
}

function factFiles() {
  return readdirSync(FACT_DIR)
    .filter((file) => file.endsWith('.mjs') && !file.startsWith('_'))
    .sort();
}

let failed = 0;

for (const file of factFiles()) {
  const moduleName = file.replace(/\.mjs$/, '').replace(/^\d+[-_]?/, '');
  let checks;
  try {
    const loaded = await import(pathToFileURL(path.join(FACT_DIR, file)).href);
    checks = loaded.checks;
    if (!Array.isArray(checks)) throw new Error('module exports no `checks` array');
  } catch (error) {
    failed += 1;
    report(false, moduleName, `fact module did not load: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  for (const { name, check } of checks) {
    try {
      const result = await check({ root: ROOT, env: process.env });
      const ok = result?.ok === true;
      if (!ok) failed += 1;
      report(ok, name, result?.detail);
    } catch (error) {
      failed += 1;
      report(false, name, `probe threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (failed > 0) {
  process.stdout.write(`${failed} fact(s) failed\n`);
  process.exit(1);
}
process.stdout.write('machine healthy\n');
