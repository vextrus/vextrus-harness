/**
 * Q-01: every guardrail rule has a fixture test proving it fires — including the
 * paths the shipped fixtures leave uncovered.
 *
 * `src/lint/__tests__/no-forbidden-escapes.test.ts` proves the five literal
 * spellings. Two firing paths have no fixture there and are proven here:
 *  - `dynamicTestMember`: a computed member whose name cannot be read statically,
 *    which is exactly how one would smuggle a modifier past the rule;
 *  - the scope rule that keeps the ban off ordinary identifiers that happen to be
 *    named `test`/`context`/`bench` (the rule must fire and must not over-fire).
 *
 * Every forbidden token is assembled from fragments so this file survives the
 * repo's own `eslint .` (AC-13 / risk note 1).
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, test } from 'vitest';

import { rule } from '../rules/no-forbidden-escapes';

const RULE_ID = 'vextrus/no-forbidden-escapes';
const SKIP = `${'sk'}ip`;
const ONLY = `${'on'}ly`;

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
          rules: { [RULE_ID]: 'error' },
          linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
        },
      ],
      'fixture.ts',
    )
    .filter((message) => message.ruleId === RULE_ID);

const messageIds = (code: string): string[] =>
  reportsOf(code).map((message) => message.messageId ?? '');

describe('a computed member on a test callee', () => {
  test.each([
    { label: 'a variable name', code: `const key = '${SKIP}';\ndescribe[key]('suite', () => {});` },
    {
      label: 'a template with an expression',
      code: `const key = '${ONLY}';\nit[\`\${key}\`]('case', () => {});`,
    },
    { label: 'a call result', code: `it[String('${SKIP}')]('case', () => {});` },
  ])('$label is reported as dynamicTestMember', ({ code }) => {
    expect(messageIds(code), code).toEqual(['dynamicTestMember']);
  });

  test.each([
    { label: 'a readable string literal', code: `describe['${SKIP}']('suite', () => {});` },
    { label: 'a readable template', code: `it[\`${ONLY}\`]('case', () => {});` },
  ])('$label is read and reported as testModifier', ({ code }) => {
    expect(messageIds(code), code).toEqual(['testModifier']);
  });

  test('a computed member that is not a modifier is left alone', () => {
    expect(messageIds(`describe['each']('suite', () => {});`)).toEqual([]);
  });
});

describe('the ban follows the test callee, not the spelling of a name', () => {
  test.each([
    {
      label: 'a parameter named context',
      code: `function row(context: Record<string, string>, key: string): string | undefined {\n  return context[key];\n}`,
    },
    {
      label: 'a parameter named test',
      code: `function readValue(test: { values: Record<string, number> }, field: string): number | undefined {\n  return test.values[field];\n}`,
    },
    {
      label: 'a local object named bench',
      code: `const bench = { ${SKIP}: 3 };\nexport const held = bench.${SKIP};`,
    },
    {
      label: 'a local object named test carrying a modifier-shaped property',
      code: `const test = { ${SKIP}: false };\nexport const held = test.${SKIP};`,
    },
    // `context` and `bench` are ordinary words, and this fixture is not a test
    // file. An undeclared one is an ambient application global far more often
    // than a runner global, so the name alone must not condemn it — otherwise
    // the rule reports Q-08 on code that has nothing to do with a suite.
    {
      label: 'an undeclared ambient global named context',
      code: `export const held: unknown = context.${SKIP};`,
    },
    {
      label: 'an undeclared ambient global named bench',
      code: `export const held: unknown = bench.${ONLY};`,
    },
  ])('$label is not reported', ({ code }) => {
    expect(reportsOf(code), code).toEqual([]);
  });

  test.each([
    { label: 'an alias of describe', code: `const group = describe;\ngroup.${SKIP}('suite', () => {});` },
    { label: 'an alias of an alias', code: `const g = it;\nconst h = g;\nh.${ONLY}('case', () => {});` },
    {
      label: 'an imported runner callee',
      code: `import { describe } from 'vitest';\ndescribe.${SKIP}('suite', () => {});`,
    },
    // The other half of that rule: `context` still cannot take a modifier once it
    // demonstrably is the runner's.
    {
      label: 'an imported context',
      code: `import { context } from 'mocha';\ncontext.${SKIP}('suite', () => {});`,
    },
  ])('$label is still reported', ({ code }) => {
    expect(messageIds(code), code).toEqual(['testModifier']);
  });
});
