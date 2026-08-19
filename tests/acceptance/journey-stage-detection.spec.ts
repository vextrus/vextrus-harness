/**
 * V-VERIFY: fail-fast ordering is observable only through the transcript, so a
 * stage name may appear in verify's output only when that stage ran. The journey
 * assertions for AC-04/AC-05 ("eslint must not run", "build must not run") are
 * read off that transcript by the helper in `tests/e2e/support/stages.ts`.
 *
 * Arbitration (m0-02-db-lane) moved the negative cases — a tool's prose naming a
 * later stage must not read as that stage having run — to the m0-01 runner leaf,
 * which owns `tests/e2e/support/stages.ts` and `scripts/lib/stage.mjs`. What is
 * left here is the agreement between the journey reader and the runner's own
 * anchored marker on runs where every reported stage did announce itself.
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
