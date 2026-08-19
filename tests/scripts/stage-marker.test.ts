/**
 * Fixture test for the stage marker (Q-01: every guardrail proves it fires).
 *
 * Fail-fast is a claim about which stages did *not* run, and that claim is read
 * off verify's transcript. So the reader has to be anchored to the line a stage
 * announces itself with: prose that merely contains a stage's name — `next
 * build` saying "Creating an optimized production build", a `tsc` error inside a
 * file whose path carries a later stage's name — is not that stage running. A
 * loose reader turns a correct fail-fast run into a false "eslint ran", which is
 * exactly the misreading V-VERIFY's exit-code contract cannot afford.
 *
 * The runner is `.mjs` and belongs to no tsconfig project; this test is `.ts`
 * and imports across that line, because `pnpm test` must execute only the
 * extensions the Q-08 guardrail lints. `allowJs` plus bundler resolution is
 * what makes the import legal.
 */
import { describe, expect, test } from 'vitest';

import { announcedStage, ranStage, stageLineIndex, stageMarker } from '../../scripts/lib/stage.mjs';

const STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'];

describe('the marker a stage announces itself with', () => {
  test('every stage name round-trips through the marker', () => {
    for (const stage of STAGES) {
      expect(announcedStage(stageMarker(stage))).toBe(stage);
    }
  });

  test('a line that is not the marker announces nothing', () => {
    const notMarkers = [
      '  Creating an optimized production build ...',
      'src/scratch/eslint-and-build.ts(1,14): error TS2322: Type mismatch',
      'stage tsc exited 2',
      'total 3.4s (typegen 0.2s, tsc 1.0s)',
      '> vextrus@0.0.0 verify /repo',
      '# == stage build ==',
      '== stage build == and then some',
    ];

    for (const line of notMarkers) {
      expect(announcedStage(line), line).toBeUndefined();
    }
  });
});

describe('reading fail-fast off a transcript', () => {
  // A real fail-fast run: tsc failed, and its diagnostic names a scratch file
  // whose path carries the names of the stages that never ran.
  const failedAtTsc = [
    stageMarker('typegen'),
    stageMarker('tsc'),
    'src/acceptance-scratch/eslint-vitest-build.ts(1,14): error TS2322: not assignable',
    'stage tsc exited 2',
    'total 1.2s (typegen 0.2s, tsc 1.0s)',
  ];

  test('the stages that ran are the ones that announced themselves', () => {
    expect(ranStage(failedAtTsc, 'typegen')).toBe(true);
    expect(ranStage(failedAtTsc, 'tsc')).toBe(true);
  });

  test('a stage named only by a diagnostic did not run', () => {
    for (const stage of ['eslint', 'vitest', 'build']) {
      expect(ranStage(failedAtTsc, stage), `${stage} must not read as having run`).toBe(false);
    }
  });

  test('the index returned is the marker line, not an earlier mention', () => {
    const output = ['  Creating an optimized production build ...', stageMarker('build')];

    expect(stageLineIndex(output, 'build')).toBe(1);
  });

  test('a whole transcript reads the same as its lines', () => {
    const transcript = [...STAGES.map(stageMarker), 'total 13.9s'].join('\n');

    expect(STAGES.map((stage) => stageLineIndex(transcript, stage))).toEqual([0, 1, 2, 3, 4]);
    expect(stageLineIndex(transcript, 'drift')).toBe(-1);
    expect(ranStage(transcript, 'drift')).toBe(false);
  });
});
