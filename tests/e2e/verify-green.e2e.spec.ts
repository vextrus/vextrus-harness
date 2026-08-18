/**
 * Journey checkpoint `verify-green` — AC-01.
 *
 * V-VERIFY: the pipeline is typegen → tsc → eslint → vitest → build, fail-fast,
 * exit code is the whole contract, wall time printed.
 */
import { describe, expect, it } from 'vitest';

import { announcedAt, runScript } from './helpers/proc';

const STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;

describe('journey: verify-green', () => {
  // AC-01: green run, every stage announced, in order, with a total wall time.
  it('pnpm verify exits 0, announces five stages in order, prints total wall time', () => {
    const run = runScript('verify');

    const positions = STAGES.map((stage) => announcedAt(run.output, stage));
    for (const [i, stage] of STAGES.entries()) {
      expect(positions[i], `stage "${stage}" was never announced`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < positions.length; i += 1) {
      const previous = positions[i - 1] ?? -1;
      const current = positions[i] ?? -1;
      expect(current, `stage "${STAGES[i]}" ran before "${STAGES[i - 1]}"`).toBeGreaterThan(previous);
    }

    // V-VERIFY: wall time printed.
    expect(run.output).toMatch(/total\s+\d+(\.\d+)?s/);

    // V-VERIFY: exit code is the whole contract.
    expect(run.code, run.output).toBe(0);
  });
});
