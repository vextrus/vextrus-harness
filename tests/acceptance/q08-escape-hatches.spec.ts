/**
 * Q-08 regression: the escape-hatch rule must be hard to walk around, and must
 * not fire on ordinary domain code.
 *
 * Q-08 forbids `.skip`/`.only` — the clause is about suites that do not run, not
 * about a particular spelling. These fixtures are the spellings that shrink the
 * suite while `pnpm verify` stays green, plus the innocent code the rule must
 * leave alone (there is no escape available: the flat config sets
 * `noInlineConfig`, so an over-fire cannot be suppressed, only worked around by
 * renaming domain identifiers).
 *
 * Every forbidden token is assembled by concatenation so this file survives the
 * repo's own `eslint .` and vitest never sees a real suite modifier.
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, test } from 'vitest';

import { rule } from '../../src/lint/rules/no-forbidden-escapes';

const RULE_ID = 'vextrus/no-forbidden-escapes';
const SKIP = `.${'skip'}`;
const ONLY = `.${'only'}`;
const SKIP_IF = `.${'skip'}If`;
const RUN_IF = `.${'run'}If`;
const TODO = `.${'to'}do`;

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

// A suite that does not run is a suite that lies — however it was spelled.
const evasions: ReadonlyArray<{ label: string; code: string }> = [
  {
    label: 'an aliased suite callee',
    code: `const group = describe;\ngroup${SKIP}('suite', () => {});`,
  },
  {
    label: 'an aliased case callee',
    code: `const check = it;\ncheck${ONLY}('case', () => {});`,
  },
  {
    label: 'a conditional skip modifier',
    code: `it${SKIP_IF}(true)('case', () => {});`,
  },
  {
    label: 'a conditional run modifier that never runs',
    code: `it${RUN_IF}(false)('case', () => {});`,
  },
  {
    label: 'a suite parked as a todo',
    code: `it${TODO}('case');`,
  },
];

describe('Q-08 — the escape-hatch rule cannot be walked around', () => {
  test.each(evasions)('$label is reported', ({ code }) => {
    expect(reportsOf(code), `expected a report for:\n${code}`).not.toEqual([]);
  });
});

// The rule guards test-suite surgery; `test`, `context` and `bench` are also
// ordinary domain words, and `noInlineConfig` leaves no way to suppress a false
// positive on them.
const domainCode: ReadonlyArray<{ label: string; code: string }> = [
  {
    label: 'a computed read from a parameter named test',
    code: `function readValue(test: { values: Record<string, number> }, field: string): number | undefined {\n  return test.values[field];\n}`,
  },
  {
    label: 'a computed read from a variable named context',
    code: `function row(context: Record<string, string>, key: string): string | undefined {\n  return context[key];\n}`,
  },
  {
    label: 'a plain property on an object named bench',
    code: `const bench = { skip: 3 };\nexport const held = bench.skip;`,
  },
];

describe('Q-08 — the rule does not fire on ordinary domain code', () => {
  test.each(domainCode)('$label is not reported', ({ code }) => {
    expect(reportsOf(code), `unexpected report for:\n${code}`).toEqual([]);
  });
});
