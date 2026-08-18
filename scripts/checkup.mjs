#!/usr/bin/env node
/**
 * V-CHECKUP: the machine's report. Every fact in `scripts/checkup.d/` runs and
 * reports; unlike verify this is never fail-fast — a broken machine should tell
 * you everything that is broken in one pass. Exit code is non-zero iff a fact failed.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { discoverSteps, repoRoot } from './lib/stage.mjs';

const facts = discoverSteps(join(repoRoot, 'scripts', 'checkup.d'));

let failed = 0;
for (const fact of facts) {
  // Captured rather than inherited so a fact that dies before reporting still
  // gets a `FAIL <name>` line of its own (AC-03) instead of vanishing.
  const result = spawnSync(process.execPath, [fact.path], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stdout !== '') process.stdout.write(stdout);
  if (stderr !== '') process.stderr.write(stderr);

  const status = result.error ? 1 : (result.status ?? 1);
  if (status === 0) continue;

  failed += 1;
  if (!/^FAIL /m.test(stdout)) {
    const reason = result.error ? result.error.message : `crashed before reporting (exit ${status})`;
    process.stdout.write(`FAIL ${fact.name} — ${reason}\n`);
  }
}

process.exit(failed === 0 ? 0 : 1);
