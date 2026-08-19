/**
 * V-VERIFY: fail-fast ordering is observable only through the transcript, so a
 * stage name may appear in verify's output only when that stage ran. The journey
 * assertions for AC-04/AC-05 ("eslint must not run", "build must not run") are
 * read off that transcript by the helper in `tests/e2e/support/stages.ts`, which
 * makes that helper a verification primitive — and B-03 forbids one that can lie.
 *
 * It lies today. It scans every line for the bare word, case-insensitively, so
 * any line that merely *mentions* a stage reads as that stage having run:
 *
 *   - `next build`'s own prose, "Creating an optimized production build", reads
 *     as the build stage having run;
 *   - a `tsc` diagnostic naming a path like `src/lint/eslint-helpers.ts` reads as
 *     the eslint stage having run — and `eslint .` prints the offending file's
 *     ABSOLUTE path on its own line, so a checkout under a directory named for a
 *     later stage (`~/build/vextrus`) turns a correct fail-fast run red on a
 *     healthy tree.
 *
 * The runner already prints an anchored marker for exactly this reason
 * (`scripts/lib/stage.mjs`), and the journey helper must read that marker rather
 * than guess from prose.
 */
import { describe, expect, test } from 'vitest';

import { ranStage as anchoredRanStage, stageMarker } from '../../scripts/lib/stage.mjs';
import { ranStage, stageLineIndex, STAGES } from '../e2e/support/stages';

/** A real fail-fast transcript: only typegen, tsc and eslint announced themselves. */
const failFastTranscript = (checkoutRoot: string): string =>
  [
    stageMarker('typegen'),
    stageMarker('tsc'),
    stageMarker('eslint'),
    '',
    `${checkoutRoot}/src/acceptance-scratch/forbidden.ts`,
    '  1:1  error  Q-08: compiler suppression comments are forbidden  vextrus/no-forbidden-escapes',
    '',
    '✖ 1 problem (1 error, 0 warnings)',
    '',
    'stage eslint exited 1',
    'total 2.8s (typegen 0.2s, tsc 1.1s, eslint 1.5s)',
  ].join('\n');

describe('the journey reads fail-fast off the marker verify prints', () => {
  test('a stage that never announced itself is not reported as having run', () => {
    // The checkout lives under a directory named `build`; nothing about this
    // transcript says the build stage ran.
    const output = failFastTranscript('/home/dev/build/vextrus');

    expect(anchoredRanStage(output, 'build'), 'the anchored reader is the truth here').toBe(false);
    expect(ranStage(output, 'build'), 'fail-fast: build must not read as having run').toBe(false);
    expect(ranStage(output, 'vitest'), 'fail-fast: vitest must not read as having run').toBe(false);
  });

  test("a tool's prose naming a stage is not that stage running", () => {
    const output = [
      stageMarker('typegen'),
      stageMarker('tsc'),
      "src/lint/eslint-helpers.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      'stage tsc exited 2',
      'total 1.3s (typegen 0.2s, tsc 1.1s)',
    ].join('\n');

    expect(ranStage(output, 'eslint'), 'a path naming eslint is not the eslint stage').toBe(false);
    expect(ranStage(output, 'vitest')).toBe(false);
    expect(ranStage(output, 'build')).toBe(false);
  });

  test('Creating an optimized production build is prose, not a stage line', () => {
    const output = [stageMarker('typegen'), 'Creating an optimized production build ...'].join('\n');

    expect(ranStage(output, 'build')).toBe(false);
  });

  test('a stage that did announce itself is still reported, in transcript order', () => {
    const output = failFastTranscript('/home/dev/vextrus');

    for (const stage of ['typegen', 'tsc', 'eslint'] as const) {
      expect(ranStage(output, stage), `stage ${stage} must be read as having run`).toBe(true);
    }
    expect(stageLineIndex(output, 'tsc')).toBeGreaterThan(stageLineIndex(output, 'typegen'));
    expect(stageLineIndex(output, 'eslint')).toBeGreaterThan(stageLineIndex(output, 'tsc'));
  });

  test('the journey reader agrees with the runner on every stage of a green run', () => {
    const output = [
      ...STAGES.map((stage) => stageMarker(stage)),
      'total 12.5s (typegen 0.2s, tsc 1.1s, eslint 1.5s, vitest 5.2s, build 4.5s)',
    ].join('\n');

    for (const stage of STAGES) {
      expect(ranStage(output, stage)).toBe(anchoredRanStage(output, stage));
    }
  });
});
