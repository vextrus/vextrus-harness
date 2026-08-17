/**
 * V-VERIFY as a contract: five stages in order, fail-fast, exit code is the
 * whole contract, wall time printed.
 *
 * Proves: V-VERIFY, Q-01 (green, no cache), Q-08 (forbidden tokens are errors),
 * B-03 (verification in seconds), AC-01, AC-04, AC-05.
 *
 * These tests drive `pnpm verify`, which itself runs `vitest run` and may pick
 * this file up again; `nestedInVerify()` is the reentrancy guard, so the child
 * run asserts the guard contract instead of recursing into another build.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { VERIFY_STAGES, announcedStages, nestedInVerify, repoRoot, runVerify } from './support/cli';

const ROOT = repoRoot();
/** Injection scratch dir, under src/ so tsc and eslint both see it. */
const SCRATCH = path.join(ROOT, 'src', '__acceptance_scratch__');
const TIMEOUT = 300_000;

function inject(fileName: string, source: string): void {
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(path.join(SCRATCH, fileName), source, 'utf8');
}

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('pnpm verify', () => {
  // V-VERIFY · AC-01: the whole lane green, stages named in order, wall time.
  it(
    'AC-01: exits 0, announces typegen → tsc → eslint → vitest → build, prints total wall time',
    { timeout: TIMEOUT },
    () => {
      if (nestedInVerify()) {
        expect(process.env.VEXTRUS_ACCEPTANCE_NESTED).toBe('1');
        return;
      }
      const result = runVerify();
      expect(result.output).toBeTruthy();
      expect(result.status).toBe(0);
      expect(announcedStages(result.output)).toEqual([...VERIFY_STAGES]);
      // V-VERIFY: "wall time printed".
      expect(result.output).toMatch(/total\s+\d+(\.\d+)?s/);
    },
  );

  // V-VERIFY · AC-04: fail-fast at tsc — the later stages must not have run.
  it(
    'AC-04: a type error under src/ fails at the tsc stage and stops the lane',
    { timeout: TIMEOUT },
    () => {
      if (nestedInVerify()) {
        expect(process.env.VEXTRUS_ACCEPTANCE_NESTED).toBe('1');
        return;
      }
      inject('type-error.ts', 'export const count: number = "not a number";\n');
      const result = runVerify();
      expect(result.status).not.toBe(0);
      const stages = announcedStages(result.output);
      expect(stages).toContain('tsc');
      // Fail-fast is observable only through stage-name absence.
      expect(stages).not.toContain('eslint');
      expect(stages).not.toContain('vitest');
      expect(stages).not.toContain('build');
    },
  );

  // Q-08 · AC-05: a forbidden escape fails the eslint stage, attributed to the
  // rule id, and the build stage never runs.
  it(
    'AC-05: a forbidden escape fails the eslint stage naming vextrus/no-forbidden-escapes',
    { timeout: TIMEOUT },
    () => {
      if (nestedInVerify()) {
        expect(process.env.VEXTRUS_ACCEPTANCE_NESTED).toBe('1');
        return;
      }
      // Constructed so this test file itself stays clean (AC-13).
      const token = `${'@'}ts-${'ignore'}`;
      inject(
        'forbidden.ts',
        `// ${token}\nexport const loose: ${`an${'y'}`} = 1;\n`,
      );
      const result = runVerify();
      expect(result.status).not.toBe(0);
      const stages = announcedStages(result.output);
      expect(stages).toContain('eslint');
      expect(result.output).toContain('vextrus/no-forbidden-escapes');
      expect(stages).not.toContain('build');
    },
  );

  // V-VERIFY interfaces: VERIFY_ONLY=<prefix> runs a single stage for debugging.
  it(
    'AC-01: VERIFY_ONLY runs a single stage and skips the rest',
    { timeout: TIMEOUT },
    () => {
      if (nestedInVerify()) {
        expect(process.env.VEXTRUS_ACCEPTANCE_NESTED).toBe('1');
        return;
      }
      const result = runVerify({ VERIFY_ONLY: '20' });
      // Only the selected stage announces itself; exit status is left to the
      // stage (a debugging aid, not a lane).
      expect(announcedStages(result.output)).toEqual(['tsc']);
    },
  );
});
