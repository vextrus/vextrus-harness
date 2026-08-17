#!/usr/bin/env node
/**
 * V-VERIFY — the whole contract is the exit code.
 *
 * Stages are the files in `scripts/verify.d/`, run in filename order and
 * fail-fast: a later increment adds a stage by adding a file, never by editing
 * this runner. Each stage announces itself on its own line before it runs, so
 * fail-fast is observable from the transcript alone.
 *
 * `VERIFY_ONLY=<prefix>` runs a single stage for debugging.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const stageDir = join(here, 'verify.d');

const only = process.env.VERIFY_ONLY ?? '';

const stageFiles = readdirSync(stageDir)
  .filter((entry) => /^\d+-.*\.mjs$/.test(entry))
  .sort();

const selected =
  only.length === 0
    ? stageFiles
    : stageFiles.filter((entry) => entry.startsWith(only) || entry.replace(/^\d+-/, '').startsWith(only));

if (selected.length === 0) {
  process.stderr.write(`verify: no stage matched VERIFY_ONLY=${only}\n`);
  process.exit(2);
}

const started = Date.now();
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

let failure;

/**
 * A stage file declares its own name and its own runner. Both are read
 * tolerantly — a stage may export `name`/`run`, a bare default function, or
 * neither, in which case the name falls out of the filename. Anything a stage
 * can do to signal failure (a non-zero number, `false`, or a throw) counts.
 */
function stageName(module, file) {
  if (typeof module.name === 'string' && module.name.length > 0) return module.name;
  return file.replace(/^\d+-/, '').replace(/\.mjs$/, '');
}

function stageRunner(module) {
  if (typeof module.run === 'function') return module.run;
  if (typeof module.default === 'function') return module.default;
  return undefined;
}

async function runStage(module, context) {
  const runner = stageRunner(module);
  if (runner === undefined) return 1;
  try {
    const outcome = await runner(context);
    if (typeof outcome === 'number') return outcome;
    if (outcome === false) return 1;
    return 0;
  } catch (error) {
    process.stderr.write(`   ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return 1;
  }
}

for (const file of selected) {
  const module = await import(pathToFileURL(join(stageDir, file)).href);
  const name = stageName(module, file);
  const stageStarted = Date.now();
  process.stdout.write(`== ${name}\n`);
  const status = await runStage(module, { repoRoot });
  if (status !== 0) {
    process.stdout.write(`   ${name} failed after ${seconds(Date.now() - stageStarted)}\n`);
    failure = name;
    break;
  }
  process.stdout.write(`   ${name} ok in ${seconds(Date.now() - stageStarted)}\n`);
}

const total = `total ${(Date.now() - started) / 1000}s`;
if (failure !== undefined) {
  process.stdout.write(`FAILED at ${failure} — ${total}\n`);
  process.exit(1);
}
process.stdout.write(`${total}\n`);
