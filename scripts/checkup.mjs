#!/usr/bin/env node
/**
 * V-CHECKUP: the machine's report. Every fact in `scripts/checkup.d/` runs and
 * reports; unlike verify this is never fail-fast — a broken machine should tell
 * you everything that is broken in one pass. Exit code is non-zero iff a fact failed.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { discoverSteps, repoRoot } from './lib/stage.mjs';

const facts = discoverSteps(join(repoRoot, 'scripts', 'checkup.d'));

/**
 * Facts run as their own processes, concurrently: they are independent probes of
 * one machine — a TCP connect that waits out its timeout should not be paid for
 * again by the next fact. Output is captured rather than inherited so the report
 * still comes out in filename order, and so a fact that dies before reporting
 * still gets a `FAIL <name>` line of its own (AC-03) instead of vanishing.
 */
const run = (fact) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [fact.path], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ fact, stdout, stderr, status: 1, error }));
    child.on('close', (code) => resolve({ fact, stdout, stderr, status: code ?? 1 }));
  });

const results = await Promise.all(facts.map(run));

let failed = 0;
for (const { fact, stdout, stderr, status, error } of results) {
  if (stdout !== '') process.stdout.write(stdout);
  if (stderr !== '') process.stderr.write(stderr);
  if (status === 0) continue;

  failed += 1;
  if (!/^FAIL /m.test(stdout)) {
    const reason = error ? error.message : `crashed before reporting (exit ${status})`;
    process.stdout.write(`FAIL ${fact.name} — ${reason}\n`);
  }
}

// Not `process.exit()`: this stdout is a pipe whenever a caller captures the
// report, and a piped stdout drains asynchronously — exiting immediately can
// truncate the very report the exit code refers to.
process.exitCode = failed === 0 ? 0 : 1;
