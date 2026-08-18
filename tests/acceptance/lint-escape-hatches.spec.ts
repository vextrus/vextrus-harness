/**
 * Q-08 / AC-05 / Q-01 — the escape hatches must stay closed against the forms a
 * developer actually reaches for, not only against the plain spelling.
 *
 * `no-forbidden-escapes` decides whether a member access is test-suite surgery by
 * walking to the identifier a chain is rooted at. That walk understands
 * `Identifier`, `MemberExpression` and `CallExpression` — and nothing else. Every
 * TypeScript expression wrapper is therefore a hole: `it!.only(...)`,
 * `(it as unknown as typeof it).skip(...)` and `(it satisfies typeof it).only(...)`
 * all compile to exactly the member call the rule exists to forbid (the assertion
 * and the casts are erased at emit), so the suite shrinks and `pnpm verify` stays
 * green. Q-08 forbids `.skip`/`.only`, full stop; a one-character `!` must not
 * buy an exemption.
 *
 * The tokens are assembled from fragments, exactly as the rule's own fixtures are,
 * so this file survives the repo's `eslint .` and vitest never discovers a real
 * modifier here.
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { rule } from '../../src/lint/rules/no-forbidden-escapes';

const SKIP = `.${'skip'}`;
const ONLY = `.${'only'}`;
const RULE_ID = 'vextrus/no-forbidden-escapes';

const linter = new Linter();

/** Lints one snippet under the same flat config `eslint.config.ts` builds. */
const reportsOf = (code: string): Linter.LintMessage[] =>
  linter
    .verify(
      code,
      [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser as unknown as Linter.Parser },
          plugins: { vextrus: { rules: { 'no-forbidden-escapes': rule } } },
          rules: { [RULE_ID]: 'error' },
          linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
        },
      ],
      'fixture.ts',
    )
    .filter((message) => message.ruleId === RULE_ID);

const importIt = `import { it } from 'vitest';\n`;

describe('vextrus/no-forbidden-escapes — type-level wrappers do not launder a suite modifier', () => {
  it.each([
    {
      label: 'non-null assertion',
      code: `${importIt}it!${ONLY}('case', () => {});`,
    },
    {
      label: 'as-cast through unknown',
      code: `${importIt}(it as unknown as typeof it)${SKIP}('case', () => {});`,
    },
    {
      label: 'satisfies expression',
      code: `${importIt}(it satisfies typeof it)${ONLY}('case', () => {});`,
    },
  ])('$label still reports the modifier', ({ code }) => {
    // The control: the same call without the wrapper is reported, so any
    // difference below is the wrapper laundering the modifier, not a bad fixture.
    expect(reportsOf(`${importIt}it${ONLY}('case', () => {});`)).toHaveLength(1);

    const reports = reportsOf(code);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.messageId).toBe('testModifier');
    expect(reports[0]?.severity).toBe(2);
  });
});
