/**
 * Journey checkpoint `verify-green` (AC-01) and the fail-fast classes AC-04, AC-05.
 *
 * Named `*.e2e.ts` on purpose: these shell out to `pnpm verify`, whose own
 * vitest stage runs the repo's `*.test.*`/`*.spec.*` files — running them there
 * would recurse. Run with:
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { describe, expect, test } from 'vitest';

import { runCli } from '../acceptance/support/cli';
import { STAGES, inject, ranStage, stageLineIndex, TOKENS } from './support/stages';

const verify = () => runCli('pnpm', ['verify'], {}, 300_000);

describe('AC-01 — checkpoint verify-green', () => {
  test('pnpm verify exits 0, names five stages in order and prints total wall time', () => {
    const result = verify();

    expect(result.status, result.output).toBe(0);

    const indices = STAGES.map((stage) => stageLineIndex(result.output, stage));
    for (const [i, stage] of STAGES.entries()) {
      expect(indices[i], `stage ${stage} must be printed`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < indices.length; i += 1) {
      expect(
        indices[i] ?? -1,
        `stage ${STAGES[i]} must be announced after ${STAGES[i - 1]}`,
      ).toBeGreaterThan(indices[i - 1] ?? -1);
    }

    // V-VERIFY: wall time printed.
    expect(result.output).toMatch(/total\s+\d+(\.\d+)?s/);
  }, 300_000);
});

describe('AC-04 — a type error stops the run at tsc', () => {
  test('verify exits non-zero at tsc and eslint, vitest and build never run', () => {
    const remove = inject(
      'src/acceptance-scratch/type-error.ts',
      'export const broken: number = "not a number";\n',
    );
    try {
      const result = verify();

      expect(result.status, result.output).not.toBe(0);
      expect(ranStage(result.output, 'tsc'), 'tsc stage must be announced').toBe(true);
      expect(ranStage(result.output, 'eslint'), 'fail-fast: eslint must not run').toBe(false);
      expect(ranStage(result.output, 'vitest'), 'fail-fast: vitest must not run').toBe(false);
      expect(ranStage(result.output, 'build'), 'fail-fast: build must not run').toBe(false);
    } finally {
      remove();
    }
  }, 300_000);
});

describe('AC-05 — a forbidden escape hatch stops the run at eslint', () => {
  test('verify fails at eslint naming vextrus/no-forbidden-escapes, and build never runs', () => {
    const remove = inject(
      'src/acceptance-scratch/forbidden.ts',
      `// ${TOKENS.tsIgnore}\nexport const value: number = 1;\n`,
    );
    try {
      const result = verify();

      expect(result.status, result.output).not.toBe(0);
      expect(ranStage(result.output, 'eslint'), 'eslint stage must be announced').toBe(true);
      expect(result.output).toMatch(/vextrus\/no-forbidden-escapes/);
      expect(ranStage(result.output, 'vitest'), 'fail-fast: vitest must not run').toBe(false);
      expect(ranStage(result.output, 'build'), 'fail-fast: build must not run').toBe(false);
    } finally {
      remove();
    }
  }, 300_000);

  test('an explicit any annotation fails the same way', () => {
    const remove = inject(
      'src/acceptance-scratch/loose.ts',
      `export function widen(value: ${TOKENS.any}): number { return Number(value); }\n`,
    );
    try {
      const result = verify();

      expect(result.status, result.output).not.toBe(0);
      expect(result.output).toMatch(/vextrus\/no-forbidden-escapes/);
    } finally {
      remove();
    }
  }, 300_000);
});
