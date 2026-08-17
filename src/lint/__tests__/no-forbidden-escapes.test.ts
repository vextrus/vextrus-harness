/**
 * Fixture tests for `vextrus/no-forbidden-escapes`.
 *
 * Proves: Q-08 (no `any`, no `@ts-ignore`/`@ts-expect-error`, no
 * `eslint-disable`, no `.skip`/`.only`), Q-01 / B-05 ("every guardrail rule has
 * a fixture test proving it fires").
 *
 * AC-13: every forbidden token below is a CONSTRUCTED string. No literal token
 * appears in this file, so `eslint .` over the repo stays green and vitest never
 * sees a real `.only`/`.skip` modifier here.
 */
import { Linter } from 'eslint';
import { RuleTester } from '@typescript-eslint/rule-tester';
import tseslint from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';

import { files, rule, severity } from '../rules/no-forbidden-escapes';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

/** The six Q-08 tokens, assembled so they never appear literally in source. */
const TOKEN = {
  any: `an${'y'}`,
  tsIgnore: `${'@'}ts-${'ignore'}`,
  tsExpectError: `${'@'}ts-${'expect'}-error`,
  eslintDisable: `eslint-${'disable'}`,
  skip: `sk${'ip'}`,
  only: `on${'ly'}`,
} as const;

/**
 * The rule reports one message id, `forbidden`, whose message names the token it
 * found — so `eslint .` output attributes the failure to
 * `vextrus/no-forbidden-escapes` and says which escape was used (AC-05).
 */
const FORBIDDEN = 'forbidden';

/**
 * The rule may be typed with either ESLint's `Rule.RuleModule` (as the
 * increment's interfaces spell it) or typescript-eslint's `RuleModule`; the two
 * describe the same object. These casts sit at that boundary and nowhere else.
 */
type TesterRule = Parameters<RuleTester['run']>[1];
type PluginRule = NonNullable<NonNullable<Linter.Config['plugins']>[string]['rules']>[string];

const ruleTester = new RuleTester({
  linterOptions: {
    // An inert directive comment is one problem (ours), not two.
    reportUnusedDisableDirectives: 'off',
  },
});

// RuleTester registers the rule under the bare name (it prefixes its own
// namespace), so the id here is the file name, not `vextrus/no-forbidden-escapes`.
ruleTester.run('no-forbidden-escapes', rule as unknown as TesterRule, {
  valid: [
    // AC-12: identifiers and strings that merely contain a token substring.
    { code: 'const company = "anywhere";' },
    { code: 'export const anyone = { count: 1 };' },
    { code: 'const props = { skipLink: true };\nexport const link = props.skipLink;' },
    { code: `export const data = { marker: ".${TOKEN.only}" };` },
    { code: `export const label = "${TOKEN.eslintDisable}";` },
    { code: 'export const has = [1, 2].some((n) => n > 1);' },
    { code: 'export const kept = [1, 2].filter((n) => n > 1);' },
    // AC-12: the honest forms of the constructs being policed.
    { code: 'export const value: unknown = null;' },
    { code: "it('runs', () => {});" },
    { code: "describe('suite', () => {});" },
    { code: '// a plain comment about linting\nexport const n = 1;' },
  ],
  invalid: [
    // Q-08: `any` as a type annotation.
    { code: `export const loose: ${TOKEN.any} = 1;`, errors: [{ messageId: FORBIDDEN }] },
    {
      code: `export function f(x: ${TOKEN.any}): number { return 1; }`,
      errors: [{ messageId: FORBIDDEN }],
    },
    // Q-08: `@ts-ignore`, line and block comment forms.
    {
      code: `// ${TOKEN.tsIgnore}\nexport const a: number = 1;`,
      errors: [{ messageId: FORBIDDEN }],
    },
    {
      code: `/* ${TOKEN.tsIgnore} */\nexport const b: number = 1;`,
      errors: [{ messageId: FORBIDDEN }],
    },
    // Q-08: `@ts-expect-error`.
    {
      code: `// ${TOKEN.tsExpectError}\nexport const c: number = 1;`,
      errors: [{ messageId: FORBIDDEN }],
    },
    // Q-08 · AC-12: the `eslint-disable` comment variants whose reports survive
    // RuleTester's default inline-directive handling; the whole-file and
    // trailing-line forms are proven below, where directives are denied authority.
    {
      code: `// ${TOKEN.eslintDisable}-next-line\nexport const e = 1;`,
      errors: [{ messageId: FORBIDDEN }],
    },
    {
      code: `/* ${TOKEN.eslintDisable}-next-line no-console */\nexport const h = 1;`,
      errors: [{ messageId: FORBIDDEN }],
    },
    // Q-08 · AC-12: `.skip` / `.only` as test-call modifiers.
    { code: `it.${TOKEN.only}('x', () => {});`, errors: [{ messageId: FORBIDDEN }] },
    { code: `test.${TOKEN.only}('x', () => {});`, errors: [{ messageId: FORBIDDEN }] },
    { code: `describe.${TOKEN.only}('x', () => {});`, errors: [{ messageId: FORBIDDEN }] },
    { code: `it.${TOKEN.skip}('x', () => {});`, errors: [{ messageId: FORBIDDEN }] },
    { code: `test.${TOKEN.skip}('x', () => {});`, errors: [{ messageId: FORBIDDEN }] },
    { code: `describe.${TOKEN.skip}('x', () => {});`, errors: [{ messageId: FORBIDDEN }] },
  ],
});

/**
 * The whole-file `/* eslint-disable *\/` form, linted the way the repo lints
 * itself: with `noInlineConfig`, so the token cannot switch off the rule that
 * bans it. This also pins the plugin-namespaced rule id that AC-05 reads out of
 * `eslint .` output.
 */
function lintWithRepoStance(code: string): Linter.LintMessage[] {
  return new Linter().verify(
    code,
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
      plugins: { vextrus: { rules: { 'no-forbidden-escapes': rule as unknown as PluginRule } } },
      rules: { 'vextrus/no-forbidden-escapes': 'error' },
    },
    'fixture.ts',
  );
}

const reportsOfOurRule = (code: string): Linter.LintMessage[] =>
  lintWithRepoStance(code).filter((m) => m.ruleId === 'vextrus/no-forbidden-escapes');

describe('no-forbidden-escapes under the repo lint stance', () => {
  // Q-08 · AC-12: a file-level disable is itself the violation.
  it('AC-12: reports the whole-file eslint-disable and is not suppressed by it', () => {
    const reports = reportsOfOurRule(`/* ${TOKEN.eslintDisable} */\nexport const d = 1;\n`);
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports[0]?.severity).toBe(2);
  });

  // Q-08 · AC-12: a trailing `eslint-disable-line` likewise cannot silence the
  // report it earns.
  it('AC-12: reports the trailing eslint-disable-line variant', () => {
    const reports = reportsOfOurRule(`export const g = 1; // ${TOKEN.eslintDisable}-line\n`);
    expect(reports.length).toBeGreaterThanOrEqual(1);
  });

  // Q-08 · AC-05: the rule id in eslint output is the namespaced one.
  it('AC-05: reports under the id vextrus/no-forbidden-escapes', () => {
    const reports = reportsOfOurRule(`export const loose: ${TOKEN.any} = 1;\n`);
    expect(reports.length).toBe(1);
    expect(reports[0]?.message ?? '').not.toBe('');
  });

  // AC-12: still no over-firing when linted this way.
  it('AC-12: reports nothing for look-alike identifiers, properties and strings', () => {
    const reports = reportsOfOurRule(
      [
        'export const company = "anywhere";',
        'export const props = { skipLink: true };',
        `export const marker = { flag: ".${TOKEN.only}" };`,
        'export const has = [1, 2].some((n) => n > 1);',
        '',
      ].join('\n'),
    );
    expect(reports).toEqual([]);
  });
});

describe('no-forbidden-escapes module shape', () => {
  // Interfaces: named exports `rule`, `files`, `severity`.
  it('AC-06: exports the registration triple the loader consumes', () => {
    expect(files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(severity).toBe('error');
    expect(typeof rule.create).toBe('function');
  });

  // Q-08 · AC-05: the reported problem must be attributable and legible.
  it('AC-05: declares the forbidden message id', () => {
    expect(Object.keys(rule.meta?.messages ?? {})).toContain(FORBIDDEN);
  });
});
