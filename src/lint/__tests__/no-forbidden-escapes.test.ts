/**
 * Q-01: every guardrail rule ships a fixture test proving it fires — and proving
 * it stays quiet on look-alikes.
 *
 * The forbidden tokens are assembled from fragments so this file itself survives
 * the repo's own `eslint .` and vitest never sees a real suite modifier.
 */
import { Linter } from 'eslint';
import { RuleTester } from '@typescript-eslint/rule-tester';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';

import { files, rule, severity } from '../rules/no-forbidden-escapes';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const LOOSE = `a${'ny'}`;
const TS_IGNORE = `@ts-${'ignore'}`;
const TS_EXPECT_ERROR = `@ts-${'expect'}-error`;
const LINT_OFF = `eslint-${'disable'}`;
const LINT_OFF_NEXT_LINE = `${LINT_OFF}-next-line`;
const SKIP = `.${'skip'}`;
const ONLY = `.${'only'}`;

const ruleTester = new RuleTester({
  // The suppression fixtures are inert text here: the tester must report the
  // rule's own findings only, not ESLint's bookkeeping about the directives.
  linterOptions: { reportUnusedDisableDirectives: 'off' },
});

// The rule module is written against ESLint's own `Rule.RuleModule`; the tester
// speaks typescript-eslint's flavour of the same object.
const underTest = rule as unknown as Parameters<typeof ruleTester.run>[1];

describe('vextrus/no-forbidden-escapes', () => {
  ruleTester.run('no-forbidden-escapes', underTest, {
    valid: [
      { code: `const total: number = 1;` },
      { code: `const value: unknown = JSON.parse('1');` },
      { code: `const company = "anywhere";` },
      { code: `const shape = { canary: true };` },
      { code: `// a comment about lint suppression in prose, not a directive` },
      { code: `const flags = { skip: false, only: false };` },
      { code: `list.filter((x) => x)${SKIP}Nothing;` },
      { code: `describe('suite', () => { it('case', () => {}); });` },
    ],
    invalid: [
      { code: `const loose: ${LOOSE} = 1;`, errors: [{ messageId: 'looseType' }] },
      {
        code: `function widen(value: ${LOOSE}): number { return Number(value); }`,
        errors: [{ messageId: 'looseType' }],
      },
      { code: `// ${TS_IGNORE}\nconst a = 1;`, errors: [{ messageId: 'compilerSuppression' }] },
      {
        code: `// ${TS_EXPECT_ERROR}\nconst b = 1;`,
        errors: [{ messageId: 'compilerSuppression' }],
      },
      {
        code: `// ${LINT_OFF_NEXT_LINE} no-console\nconst d = 1;`,
        errors: [{ messageId: 'lintSuppression' }],
      },
      {
        code: `/* ${LINT_OFF_NEXT_LINE} no-console */\nconst e = 1;`,
        errors: [{ messageId: 'lintSuppression' }],
      },
      { code: `describe${SKIP}('suite', () => {});`, errors: [{ messageId: 'testModifier' }] },
      { code: `it${ONLY}('case', () => {});`, errors: [{ messageId: 'testModifier' }] },
      { code: `test${ONLY}('case', () => {});`, errors: [{ messageId: 'testModifier' }] },
      { code: `test${SKIP}('case', () => {});`, errors: [{ messageId: 'testModifier' }] },
    ],
  });

  // A blanket disable is the one variant that cannot be proven with the tester:
  // it switches every rule off, so the proof has to run under the same
  // `noInlineConfig` the real flat config sets.
  describe('a blanket disable cannot switch the rule off', () => {
    const linter = new Linter();
    const reportsOf = (code: string): Linter.LintMessage[] =>
      linter
        .verify(
          code,
          [
            {
              files: ['**/*.ts'],
              languageOptions: { parser: tseslint.parser as unknown as Linter.Parser },
              plugins: { vextrus: { rules: { 'no-forbidden-escapes': rule } } },
              rules: { 'vextrus/no-forbidden-escapes': 'error' },
              linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
            },
          ],
          'fixture.ts',
        )
        .filter((message) => message.ruleId === 'vextrus/no-forbidden-escapes');

    it.each([
      { label: 'block form', code: `/* ${LINT_OFF} */\nconst c = 1;` },
      { label: 'line form', code: `// ${LINT_OFF}\nconst c = 1;` },
    ])('$label is reported as an error', ({ code }) => {
      const reports = reportsOf(code);

      expect(reports).toHaveLength(1);
      expect(reports[0]?.severity).toBe(2);
    });
  });

  it('exports the registration triple the loader consumes', () => {
    expect(files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(severity).toBe('error');
    expect(typeof rule.create).toBe('function');
  });
});
