#!/usr/bin/env node
/**
 * V-CHECKUP: the machine's report. Every fact in `scripts/checkup.d/` runs and
 * reports; unlike verify this is never fail-fast — a broken machine should tell
 * you everything that is broken in one pass. Exit code is non-zero iff a fact failed.
 */
import { join } from 'node:path';

import { discoverSteps, repoRoot, runStep } from './lib/stage.mjs';

const facts = discoverSteps(join(repoRoot, 'scripts', 'checkup.d'));

let failed = 0;
for (const fact of facts) {
  if (runStep(fact) !== 0) failed += 1;
}

process.exit(failed === 0 ? 0 : 1);
