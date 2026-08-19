/**
 * Q-08 / B-03 — the escape hatches this codebase does not have, and the places
 * the guardrail currently cannot see them.
 *
 * Q-08 is a must-clause about the suite: `.skip`/`.only` are forbidden because a
 * suite that does not run is a suite that lies (B-03: no verification primitive
 * that can lie). `pnpm verify` is the only thing that enforces it, so the claim
 * under test here is behavioural — a Q-08 escape in a file this repo executes
 * must not be able to pass `pnpm verify` — not a claim about any one glob.
 *
 * Every forbidden token below is assembled from fragments, exactly as the rule's
 * own fixtures are (risk note 1): a file that spells them out would fail the very
 * rule it is testing, and `.only` written literally would shrink this suite.
 */
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, expect, it } from 'vitest';

import vitestConfig from '../../vitest.config';
import { files as ruleFiles, rule } from '../../src/lint/rules/no-forbidden-escapes';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ONLY = `${'on'}ly`;

/** `src/**\/*.{test,spec}.{ts,tsx}` -> ['ts','tsx']; `scripts/**\/*.test.mjs` -> ['mjs']. */
function extensionsOf(glob: string): string[] {
  const tail = /\.(\{[^}]*\}|[A-Za-z0-9]+)$/.exec(glob)?.[1];
  if (tail === undefined) return [];
  return tail.startsWith('{')
    ? tail
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
    : [tail];
}

describe('Q-08 escapes cannot hide in a file the repo executes as a test', () => {
  /**
   * The suite `pnpm verify` runs is defined by `vitest.config.ts`'s include list.
   * Whatever that list executes, the guardrail has to be able to read — otherwise
   * a modifier dropped into one of those files shrinks the suite while verify
   * stays green, which is precisely the lie B-03 forbids.
   *
   * Deliberately not an assertion about the rule's `files` globs: the fix may be
   * to widen the guardrail, or to stop executing tests the guardrail cannot lint.
   * Either way this stays true.
   */
  it('every file extension `pnpm test` executes is an extension the Q-08 rule lints', () => {
    const include = vitestConfig.test?.include ?? [];
    const guarded = new Set(ruleFiles.flatMap(extensionsOf));

    const executed = [...new Set(include.flatMap(extensionsOf))].sort();
    const unguarded = executed.filter((extension) => !guarded.has(extension));

    expect(
      unguarded,
      `vitest executes ${executed.join(', ')} but the Q-08 guardrail only lints ${[...guarded].join(', ')}: ` +
        `a suite modifier in a ${unguarded.join('/')} test file shrinks the run with pnpm verify green`,
    ).toEqual([]);
  });
});

describe('vextrus/no-forbidden-escapes — aliasing does not launder a suite modifier', () => {
  const ruleTester = new RuleTester();
  const underTest = rule as unknown as Parameters<typeof ruleTester.run>[1];

  /**
   * The rule already resolves a modifier taken off an alias of a runner callee.
   * It stops resolving after a handful of hops, and a chain is free to be longer:
   * five `const` hops leave `it` as the callee that actually runs, so the suite
   * shrinks exactly as much as `it`-dot-modifier would.
   *
   * And it must still keep quiet on the look-alike: an ordinary object reached
   * through the same number of hops is not a suite.
   */
  ruleTester.run('no-forbidden-escapes', underTest, {
    valid: [
      {
        code:
          `const plain = { ${ONLY}: 1 };\n` +
          `const a = plain; const b = a; const c = b; const d = c; const e = d;\n` +
          `export const value = e.${ONLY};\n`,
      },
    ],
    invalid: [
      {
        code:
          `import { it } from 'vitest';\n` +
          `const a = it; const b = a; const c = b; const d = c; const e = d;\n` +
          `e.${ONLY}('case', () => undefined);\n`,
        errors: [{ messageId: 'testModifier' }],
      },
    ],
  });
});

describe('vextrus/no-forbidden-escapes — an import is judged by the module it came from', () => {
  const ruleTester = new RuleTester();
  const underTest = rule as unknown as Parameters<typeof ruleTester.run>[1];

  /**
   * The rule already refuses to judge a namespace import on its name alone — it
   * checks the module the binding came from, so `import * as path from
   * 'node:path'` is not a runner. A named import deserves the same reading: a
   * domain module is free to export a function called `test` or an object called
   * `context`, and a property access on it is ordinary code, not suite surgery.
   *
   * This is not a style point. Q-08 also forbids the lint-suppression comment, so a false
   * report here has no escape hatch at all: the only way out is renaming domain
   * code to please a lint rule.
   */
  ruleTester.run('no-forbidden-escapes', underTest, {
    valid: [
      {
        code:
          `import { test } from './lab/protocol';\n` +
          `export const run = (): void => test.${'to'}do('measure');\n`,
      },
      {
        code: `import { context } from './trace';\nexport const flag = context.${'sk'}ip;\n`,
      },
    ],
    invalid: [],
  });
});
