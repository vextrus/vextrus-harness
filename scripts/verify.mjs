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

const total = seconds(startedAt);
process.stdout.write(`total ${total}s\n`);

// Q-01: V-VERIFY is green *and* ≤ 60 s locally. A budget nobody enforces is a
// budget the increments spend, so the run states it and fails on it. Only a full
// run is judged — VERIFY_ONLY is a debugging subset, not the contract.
const budget = Number(process.env['VERIFY_BUDGET_SECONDS'] ?? '60');
const wholeRun = steps.length === all.length;
if (wholeRun && Number.isFinite(budget) && budget > 0 && Number(total) > budget) {
  process.stdout.write(`FAIL budget — total ${total}s exceeds the Q-01 budget of ${budget}s\n`);
  process.exit(1);
}
