#!/usr/bin/env node
/**
 * V-VERIFY: run every stage in `scripts/verify.d/` in filename order, fail-fast,
 * and print the wall time. The exit code is the whole contract.
 *
 * A later increment adds a stage by dropping in a file — this runner names none.
 */
import { join } from 'node:path';

import { discoverSteps, repoRoot, runStep, seconds } from './lib/stage.mjs';

const startedAt = Date.now();
const only = process.env['VERIFY_ONLY'];
const all = discoverSteps(join(repoRoot, 'scripts', 'verify.d'));
const steps = only === undefined || only === '' ? all : all.filter((s) => s.name.startsWith(only) || s.file.startsWith(only));

if (steps.length === 0) {
  process.stdout.write(`no stages matched ${String(only)}\n`);
  process.exit(1);
}

for (const step of steps) {
  process.stdout.write(`== ${step.name}\n`);
  const status = runStep(step);
  if (status !== 0) {
    process.stdout.write(`stage ${step.name} exited ${status}\n`);
    process.stdout.write(`total ${seconds(startedAt)}s\n`);
    process.exit(status);
  }
}

process.stdout.write(`total ${seconds(startedAt)}s\n`);
