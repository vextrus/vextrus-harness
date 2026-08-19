#!/usr/bin/env node
/**
 * V-VERIFY: run every stage in `scripts/verify.d/` in filename order, fail-fast,
 * and print the wall time. The exit code is the whole contract.
 *
 * A later increment adds a stage by dropping in a file — this runner names none.
 *
 * What the run prints is itself part of the contract, because fail-fast ordering
 * is observable only through it. So the rule here is: a stage name appears in the
 * transcript when, and only when, that stage ran. Stage output is captured and
 * printed under the failing stage's line; a green run prints its five stage lines
 * and its wall time, and the closing breakdown names exactly the stages that ran.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  budgetVerdict,
  discoverSteps,
  pruneStaleRunDirs,
  repoRoot,
  recordRunTiming,
  runStep,
  seconds,
  stageMarker,
  verifyRunDir,
} from './lib/stage.mjs';

/**
 * A reader may walk away mid-report — `pnpm verify | head` closes the pipe —
 * and a broken pipe is that reader's decision, not a crash worth a stack trace
 * on top of the transcript.
 */
const ignoreBrokenPipe = (stream) => {
  stream.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
  });
};
ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

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

const startedAt = Date.now();
const only = process.env['VERIFY_ONLY'];
const all = discoverSteps(join(repoRoot, 'scripts', 'verify.d'));
const steps =
  only === undefined || only === ''
    ? all
    : all.filter((s) => s.name.startsWith(only) || s.file.startsWith(only));

if (steps.length === 0) {
  process.stdout.write(`no stages matched ${String(only)}\n`);
  // Never `process.exit()`: stdout is a pipe whenever a caller captures this run
  // (the acceptance suite does), and a piped stdout drains asynchronously — an
  // immediate exit can drop the very line the exit code refers to.
  process.exitCode = 1;
} else {
  let failed = 0;
  /** Stages that actually ran, with what each cost — the only names printed at the end. */
  const ran = [];
  try {
    for (const step of steps) {
      process.stdout.write(`${stageMarker(step.name)}\n`);
      const stageStartedAt = Date.now();
      const { status, stdout, stderr } = runStep(step);
      ran.push(`${step.name} ${seconds(stageStartedAt)}s`);
      if (status !== 0) {
        // The diagnosis belongs to the stage that failed, printed under its line.
        if (stdout !== '') process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`);
        if (stderr !== '') process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
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
  process.stdout.write(`total ${total}s (${ran.join(', ')})\n`);

  // Q-01's ≤ 60 s budget is measured on every whole run and written down, so the
  // clock is a number somebody can read rather than a hope: a later increment
  // that walks the total past the budget leaves it in the transcript and in
  // `.next-verify/last-run.json`. A partial run (VERIFY_ONLY) is not measured
  // against a whole-run budget.
  const wholeRun = steps.length === all.length;
  const verdict = wholeRun
    ? budgetVerdict(total)
    : { budget: undefined, exceeded: false, enforced: false };

  recordRunTiming({
    finishedAt: new Date().toISOString(),
    totalSeconds: Number(total),
    stages: ran.map((entry) => {
      const [name, cost] = entry.split(' ');
      return { name, seconds: Number(String(cost).replace(/s$/, '')) };
    }),
    wholeRun,
    failedExitCode: failed,
    budgetSeconds: verdict.budget ?? null,
    overBudget: verdict.exceeded,
  });

  if (failed !== 0) {
    process.exitCode = failed;
  } else if (verdict.exceeded) {
    process.stdout.write(
      `note budget — total ${total}s exceeds the Q-01 local budget of ${String(verdict.budget)}s\n`,
    );
    // Reported, not failed, by default: AC-01 is that a clean checkout exits 0
    // after the five stages, and making the exit code depend on the wall clock
    // would turn a cold CI container into a red tree nobody can reproduce. A
    // caller that wants the clock to be a hard edge sets VERIFY_BUDGET_ENFORCE.
    if (verdict.enforced) process.exitCode = 1;
  }
}
