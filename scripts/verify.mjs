#!/usr/bin/env node
/**
 * V-VERIFY: run every stage in `scripts/verify.d/` in filename order, fail-fast,
 * and print the wall time. The exit code is the whole contract.
 *
 * A later increment adds a stage by dropping in a file — this runner names none.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { discoverSteps, pruneStaleRunDirs, repoRoot, runStep, seconds, verifyRunDir } from './lib/stage.mjs';

/**
 * Every stage of this run shares one scratch directory under `.next-verify` and
 * no other run touches it, so `next typegen`'s route types cannot be rewritten
 * by a concurrent verify while this run's tsc stage reads them. The stages are
 * separate processes, so the id travels in the environment.
 */
process.env['VERIFY_RUN_ID'] = String(process.pid);
const runDir = join(repoRoot, verifyRunDir());

// A run that was killed cannot clean up after itself, so every run cleans up
// after the dead before it starts.
pruneStaleRunDirs();

/**
 * Fail-fast ordering is observable only through these lines, so they must be
 * impossible to confuse with the stages' own output: a `tsc` error inside
 * `eslint.config.ts`, or vitest naming a test file, must not read as "the eslint
 * stage ran". The marker is therefore a whole line of its own, anchored at the
 * start, wrapping the bare stage name in a token nothing else prints.
 */
const STAGE_MARKER = (name) => `== stage ${name} ==`;

const startedAt = Date.now();
const only = process.env['VERIFY_ONLY'];
const all = discoverSteps(join(repoRoot, 'scripts', 'verify.d'));
const steps = only === undefined || only === '' ? all : all.filter((s) => s.name.startsWith(only) || s.file.startsWith(only));

if (steps.length === 0) {
  process.stdout.write(`no stages matched ${String(only)}\n`);
  // Never `process.exit()`: stdout is a pipe whenever a caller captures this run
  // (the acceptance suite does), and a piped stdout drains asynchronously — an
  // immediate exit can drop the very line the exit code refers to.
  process.exitCode = 1;
} else {
  let failed = 0;
  try {
    for (const step of steps) {
      process.stdout.write(`${STAGE_MARKER(step.name)}\n`);
      const status = runStep(step);
      if (status !== 0) {
        process.stdout.write(`stage ${step.name} exited ${status}\n`);
        failed = status;
        break;
      }
    }
  } finally {
    // The scratch space is this run's alone, so it goes when the run does — a
    // report on the tree does not leave scratch behind. In a `finally` because a
    // stage that fails to spawn at all throws, and scratch left behind by a
    // failed run is still scratch left behind.
    rmSync(runDir, { recursive: true, force: true });
  }

  const total = seconds(startedAt);
  process.stdout.write(`total ${total}s\n`);

  if (failed !== 0) {
    process.exitCode = failed;
  } else {
    // Q-01 names a ≤ 60 s *local* budget, and the run says so when it is missed —
    // but it does not fail on it. AC-01 is that a clean checkout exits 0 after the
    // five stages; making the exit code depend on the wall clock would mean a green
    // tree reporting failure on a slow box or a cold CI container, and a failure
    // nobody can reproduce. The exit code says whether the contract held.
    const budget = Number(process.env['VERIFY_BUDGET_SECONDS'] ?? '60');
    const wholeRun = steps.length === all.length;
    if (wholeRun && Number.isFinite(budget) && budget > 0 && Number(total) > budget) {
      process.stdout.write(`note budget — total ${total}s exceeds the Q-01 local budget of ${budget}s\n`);
    }
  }
}
