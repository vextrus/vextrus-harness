/**
 * AC-01, AC-04, AC-05 — `pnpm verify` is the whole contract: ordered stages,
 * fail-fast, exit code, wall time.
 *
 * Forbidden tokens (Q-08) are assembled from fragments so this file itself
 * stays green under `eslint .` (AC-13).
 */
import { describe, expect, it } from 'vitest';
import { nested, pnpm, stageIndex, stageRan, withScratchFile } from '../support/proc';

const STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;
const SLOW = 300_000;

const ANY = 'an' + 'y';
const TS_IGNORE = '@' + 'ts-ignore';

describe('AC-01/AC-04/AC-05 pnpm verify', () => {
  if (nested) {
    // `pnpm verify` runs vitest, which loads this file. Do not recurse.
    it('is skipped inside a verify run (recursion guard)', () => {
      expect(nested).toBe(true);
    });
    return;
  }

  it(
    'AC-01: exits 0, announces typegen → tsc → eslint → vitest → build in order, prints total wall time',
    async () => {
      const result = await pnpm(['verify'], { timeoutMs: SLOW });
      expect(result.all).toBeTruthy();
      expect(result.code, `pnpm verify failed:\n${result.all}`).toBe(0);

      for (const stage of STAGES) {
        expect(stageRan(result.all, stage), `stage "${stage}" was never announced`).toBe(true);
      }
      const positions = STAGES.map((stage) => stageIndex(result.all, stage));
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions, `stages ran out of order: ${STAGES.join(' → ')}`).toEqual(sorted);

      // V-VERIFY: "wall time printed"
      expect(result.all).toMatch(/total\s+\d+(\.\d+)?s/);
    },
    SLOW,
  );

  it(
    'AC-04: a type error under src/ fails at tsc and the eslint, vitest and build stages never run',
    async () => {
      const source = [
        'export const brokenOnPurpose: number = "not a number";',
        '',
      ].join('\n');
      const result = await withScratchFile('src/__scratch__/type-error.ts', source, () =>
        pnpm(['verify'], { timeoutMs: SLOW }),
      );

      expect(result.code, 'verify must fail on a type error').not.toBe(0);
      expect(stageRan(result.all, 'tsc'), 'the tsc stage must have run').toBe(true);
      for (const stage of ['eslint', 'vitest', 'build'] as const) {
        expect(stageRan(result.all, stage), `fail-fast broken: "${stage}" ran after tsc failed`).toBe(false);
      }
    },
    SLOW,
  );

  it(
    'AC-05: a forbidden escape fails at the eslint stage naming vextrus/no-forbidden-escapes',
    async () => {
      const source = [
        `// ${TS_IGNORE}`,
        `export const escapeHatch: ${ANY} = 1;`,
        '',
      ].join('\n');
      const result = await withScratchFile('src/__scratch__/forbidden.ts', source, () =>
        pnpm(['verify'], { timeoutMs: SLOW }),
      );

      expect(result.code, 'verify must fail on a forbidden escape').not.toBe(0);
      expect(stageRan(result.all, 'eslint'), 'the eslint stage must have run').toBe(true);
      expect(result.all).toContain('vextrus/no-forbidden-escapes');
      // fail-fast: nothing after eslint
      for (const stage of ['vitest', 'build'] as const) {
        expect(stageRan(result.all, stage), `fail-fast broken: "${stage}" ran after eslint failed`).toBe(false);
      }
    },
    SLOW,
  );
});
