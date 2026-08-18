/**
 * AC-04 and AC-05 — V-VERIFY "fail-fast", observed through stage announcements.
 *
 * Both injections are written into the tree, exercised, then removed; the tree
 * is left exactly as found (B-03: no cache that can lie, no residue).
 */
import { describe, expect, it } from 'vitest';

import { announced, runScript, withScratchFile } from './helpers/proc';

// AC-05 must not put the forbidden token in this file itself (AC-13): build it.
const AT = '@';
const TS_IGNORE = `${AT}ts-` + 'ignore';

describe('verify fail-fast', () => {
  // AC-04: a type error stops the run at tsc; later stages never announce.
  it('stops at tsc on a type error, without running eslint, vitest or build', () => {
    const run = withScratchFile(
      'src/__acceptance_scratch_type_error.ts',
      'export const broken: number = "not a number";\n',
      () => runScript('verify'),
    );

    expect(run.code, run.output).not.toBe(0);
    expect(announced(run.output, 'tsc'), 'tsc stage was never announced').toBe(true);
    expect(announced(run.output, 'eslint'), 'eslint ran after tsc failed').toBe(false);
    expect(announced(run.output, 'vitest'), 'vitest ran after tsc failed').toBe(false);
    expect(announced(run.output, 'build'), 'build ran after tsc failed').toBe(false);
  });

  // AC-05: a forbidden escape stops the run at eslint, naming the rule id.
  it('stops at eslint on a forbidden escape, naming vextrus/no-forbidden-escapes', () => {
    const source = [
      '// ' + TS_IGNORE,
      'export const scratch = 1;',
      '',
    ].join('\n');
    const run = withScratchFile('src/__acceptance_scratch_escape.ts', source, () =>
      runScript('verify'),
    );

    expect(run.code, run.output).not.toBe(0);
    expect(announced(run.output, 'eslint'), 'eslint stage was never announced').toBe(true);
    expect(run.output).toContain('vextrus/no-forbidden-escapes');
    expect(announced(run.output, 'vitest'), 'vitest ran after eslint failed').toBe(false);
    expect(announced(run.output, 'build'), 'build ran after eslint failed').toBe(false);
  });
});
