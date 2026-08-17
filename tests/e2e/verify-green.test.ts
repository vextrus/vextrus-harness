import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isNestedRun, pnpm, repoRoot, scratch, stageIndex, stagesAnnounced } from './support/proc';

const SCRATCH_DIR = 'src/__acceptance_scratch__';

/**
 * Journey checkpoint: verify-green — the transcript of `pnpm verify`.
 * Skipped only when we are ourselves running inside a verify child process.
 */
describe.runIf(!isNestedRun())('checkpoint: verify-green', () => {
  afterEach(() => {
    rmSync(join(repoRoot, SCRATCH_DIR), { recursive: true, force: true });
  });

  // AC-01 / V-VERIFY / Q-01: green run, five stages in order, wall time printed.
  it('runs the five stages in order, exits 0 and prints total wall time', async () => {
    const result = await pnpm('verify');

    expect(result.out).toMatch(/total\s+\d+(\.\d+)?s/);
    expect(stagesAnnounced(result.out)).toEqual(['typegen', 'tsc', 'eslint', 'vitest', 'build']);
    expect(result.code, `verify failed:\n${result.out}`).toBe(0);
  }, 600_000);

  // AC-04 / V-VERIFY: fail-fast at tsc — later stages never announce themselves.
  it('stops at the tsc stage on a type error, running no later stage', async () => {
    const dispose = scratch(
      `${SCRATCH_DIR}/type-error.ts`,
      'export const answer: number = "not a number";\n',
    );
    try {
      const result = await pnpm('verify');

      expect(result.code).not.toBe(0);
      expect(stageIndex(result.out, 'tsc')).toBeGreaterThanOrEqual(0);
      expect(stagesAnnounced(result.out)).toEqual(['typegen', 'tsc']);
    } finally {
      dispose();
    }
  }, 600_000);

  // AC-05 / Q-08: a forbidden escape fails the eslint stage, by rule id.
  it('fails at the eslint stage with vextrus/no-forbidden-escapes', async () => {
    // Token assembled at runtime so this test file itself stays lint-clean (AC-13).
    const forbidden = `// @${'ts'}-ignore\nexport const value = 1;\n`;
    const dispose = scratch(`${SCRATCH_DIR}/escape.ts`, forbidden);
    try {
      const result = await pnpm('verify');

      expect(result.code).not.toBe(0);
      expect(result.out).toContain('vextrus/no-forbidden-escapes');
      expect(stagesAnnounced(result.out)).toEqual(['typegen', 'tsc', 'eslint']);
    } finally {
      dispose();
    }
  }, 600_000);
});
