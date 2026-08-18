#!/usr/bin/env node
/**
 * V-VERIFY: the whole contract in one exit code.
 *
 * Stages are files in `scripts/verify.d/`, run in filename order, fail-fast; a
 * later increment adds a stage by adding a file, never by editing this runner
 * (B-03). Each stage is a real process, so its exit code is the stage's verdict
 * and its output is the transcript. Wall time is printed because the Bible says
 * so (Q-01: ≤ 60 s local, no cache).
 *
 * `VERIFY_ONLY=<prefix>` runs the single stage whose file name starts with the
 * prefix — a debugging aid, not a lane.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STAGE_DIR = path.join(ROOT, 'scripts', 'verify.d');

/** `10-typegen.mjs` → `typegen`: the name the transcript announces. */
function stageName(file) {
  return file.replace(/\.mjs$/, '').replace(/^\d+[-_]?/, '');
}

function stageFiles() {
  const only = process.env.VERIFY_ONLY;
  return readdirSync(STAGE_DIR)
    .filter((file) => file.endsWith('.mjs') && !file.startsWith('_'))
    .sort()
    .filter((file) => only === undefined || only === '' || file.startsWith(only));
}

const started = Date.now();
const files = stageFiles();

if (files.length === 0) {
  process.stderr.write(`no verify stages matched${process.env.VERIFY_ONLY ? ` VERIFY_ONLY=${process.env.VERIFY_ONLY}` : ''}\n`);
  process.exit(1);
}

for (const file of files) {
  const name = stageName(file);
  // Announced one at a time: the absence of a name downstream is how fail-fast
  // is observed (AC-04, AC-05, AC-09).
  process.stdout.write(`== ${name}\n`);
  const stageStarted = Date.now();
  const result = spawnSync(process.execPath, [path.join(STAGE_DIR, file)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  const seconds = ((Date.now() - stageStarted) / 1000).toFixed(1);
  const status = result.status ?? 1;
  if (status !== 0) {
    process.stdout.write(`FAILED after ${seconds}s (exit ${status})\n`);
    process.stdout.write(`total ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    process.exit(status);
  }
  process.stdout.write(`   ok ${seconds}s\n`);
}

process.stdout.write(`total ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
