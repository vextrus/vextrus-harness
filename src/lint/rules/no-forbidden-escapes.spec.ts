/**
 * Acceptance for the Q-08 escape-hatch rule (AC-06).
 *
 * The rule is exercised through ESLint's own Linter with the same plugin
 * namespace the flat config uses, so the assertions can name the rule id
 * `vextrus/no-forbidden-escapes` without depending on the Builder's messageIds.
 *
 * Every forbidden token is built by concatenation, so this file itself stays
 * green under the repo's `eslint .` and vitest never sees a real test modifier
 * in fixture text (AC-13 / risk note 1).
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, test } from 'vitest';

import { files, rule, severity } from './no-forbidden-escapes';

const TS_IGNORE = `@ts-${'ignore'}`;
const TS_EXPECT_ERROR = `@ts-${'expect'}-error`;
const ESLINT_DISABLE = `eslint-${'disable'}`;
const ESLINT_DISABLE_NEXT_LINE = `${ESLINT_DISABLE}-next-line`;
const ONLY = `.${'only'}`;
const SKIP = `.${'skip'}`;
const ANY = `a${'ny'}`;

const RULE_ID = 'vextrus/no-forbidden-escapes';

const linter = new Linter();

function lint(code: string): Linter.LintMessage[] {
  return linter.verify(
    code,
    [
      {
        // A flat config only applies to the files it matches.
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser as unknown as Linter.Parser },
        plugins: { vextrus: { rules: { 'no-forbidden-escapes': rule } } },
        rules: { [RULE_ID]: 'error' },
        // An escape hatch must not be able to switch off the rule that forbids it.
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
      },
    ],
    'fixture.ts',
  );
}

const reportsOf = (code: string): Linter.LintMessage[] =>
  lint(code).filter((message) => message.ruleId === RULE_ID);

// AC-06: each of the six Q-08 tokens is reported as an error.
const forbidden: ReadonlyArray<{ token: string; code: string }> = [
  { token: 'any (type annotation)', code: `const loose: ${ANY} = 1;` },
  { token: 'any (parameter)', code: `function f(x: ${ANY}): void { void x; }` },
  { token: TS_IGNORE, code: `// ${TS_IGNORE}\nconst a = 1;` },
  { token: TS_EXPECT_ERROR, code: `// ${TS_EXPECT_ERROR}\nconst b = 1;` },
  { token: `${ESLINT_DISABLE} (block)`, code: `/* ${ESLINT_DISABLE} */\nconst c = 1;` },
  {
    token: `${ESLINT_DISABLE_NEXT_LINE} (line)`,
    code: `// ${ESLINT_DISABLE_NEXT_LINE} no-console\nconst d = 1;`,
  },
  {
    token: `${ESLINT_DISABLE} (block, next line)`,
    code: `/* ${ESLINT_DISABLE_NEXT_LINE} no-console */\nconst e = 1;`,
  },
  { token: SKIP, code: `describe${SKIP}('suite', () => {});` },
  { token: ONLY, code: `it${ONLY}('case', () => {});` },
  { token: `test${ONLY}`, code: `test${ONLY}('case', () => {});` },
];

describe('AC-06 — every Q-08 escape hatch is a lint error', () => {
  test.each(forbidden)('$token is reported by vextrus/no-forbidden-escapes', ({ code }) => {
    const reports = reportsOf(code);

    expect(reports.length, `expected one report for:\n${code}`).toBe(1);
    expect(reports[0]?.severity, 'the rule is an error, never a warning').toBe(2);
  });
});

// The rule must stay quiet on innocent look-alikes — a rule that cries wolf is
// the fastest way to get itself disabled.
const innocent: ReadonlyArray<{ label: string; code: string }> = [
  { label: 'a plain typed constant', code: `const total: number = 1;` },
  { label: 'a word containing the any substring', code: `const company = "anywhere";` },
  { label: 'unknown instead of the loose type', code: `const value: unknown = 1;` },
];

describe('AC-06 — the rule does not cry wolf', () => {
  test.each(innocent)('$label is not reported', ({ code }) => {
    expect(reportsOf(code)).toEqual([]);
  });
});

// AC-06 / interface contract: the module exports the registration triple the
// loader consumes.
test('no-forbidden-escapes exports the loader registration contract', () => {
  expect(files).toEqual(['**/*.ts', '**/*.tsx']);
  expect(severity).toBe('error');
  expect(typeof rule.create).toBe('function');
});
