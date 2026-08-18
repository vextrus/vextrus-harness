/**
 * Acceptance for AC-06 / AC-12 / AC-13 (Bible Q-08, Q-01).
 *
 * Q-01: every guardrail rule has a fixture test proving it fires.
 * Q-08: no `any` type, no TypeScript suppression directives, no ESLint disable
 *       comments, no focused or skipped tests.
 *
 * AC-13: every forbidden token below is assembled by string concatenation and
 * never written literally, so `eslint .` over this repository stays green and
 * vitest never sees a real `.only` / `.skip` modifier in this file.
 */
import { Linter } from 'eslint';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, expect, it } from 'vitest';

import { files, rule, severity } from '../rules/no-forbidden-escapes';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

/** Forbidden tokens, assembled so this source file never contains them (AC-13). */
const AT = '@';
const TS_IGNORE = `${AT}ts-` + 'ignore';
const TS_EXPECT_ERROR = `${AT}ts-` + 'expect-error';
const ESLINT_DISABLE = 'es' + 'lint-disable';
const ANY = 'an' + 'y';
const ONLY = 'on' + 'ly';
const SKIP = 'sk' + 'ip';

/** The rule id the loader must register under (interfaces: plugin namespace `vextrus`). */
const RULE_ID = 'vextrus/no-forbidden-escapes';

/**
 * Structural view of `RuleTester#run`. Deliberately loose: the acceptance must
 * not couple to the exact generic signature of the pinned rule-tester, only to
 * the behaviour that valid fixtures report nothing and invalid ones report.
 */
type RunFixtures = (
  name: string,
  ruleModule: unknown,
  tests: { valid: { code: string }[]; invalid: { code: string; errors: number }[] },
) => void;

const ruleTester = new RuleTester();
const run = ruleTester.run.bind(ruleTester) as unknown as RunFixtures;

/**
 * Second harness, used only for the ESLint disable-comment family. Such a comment
 * would otherwise suppress the rule's own report (that is exactly the escape
 * hatch Q-08 bans), so the fixture runs the rule through a Linter with
 * `noInlineConfig` and counts only reports carrying our rule id — ESLint's own
 * meta-warning about the ignored directive is filtered out by `ruleId`.
 */
const linter = new Linter();
function verifyFixture(code: string): Linter.LintMessage[] {
  return linter.verify(
    code,
    {
      files: ['**/*.ts', '**/*.tsx'],
      plugins: { vextrus: { rules: { 'no-forbidden-escapes': rule } } },
      rules: { [RULE_ID]: 'error' },
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    },
    'fixture.ts',
  );
}
function reportsFor(code: string): string[] {
  return verifyFixture(code)
    .filter((m) => m.ruleId === RULE_ID)
    .map((m) => m.message);
}

describe('vextrus/no-forbidden-escapes registration', () => {
  // AC-06: the rule module ships the registration shape the loader consumes.
  it('exports { rule, files, severity } as the loader contract', () => {
    expect(severity).toBe('error');
    expect(files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(typeof rule.create).toBe('function');
  });

  // AC-05 depends on this exact rule id appearing in `eslint .` output.
  it('reports under the id vextrus/no-forbidden-escapes', () => {
    const ids = verifyFixture(`it.${ONLY}("case", () => {});`).map((m) => m.ruleId);
    expect(ids).toContain(RULE_ID);
  });
});

describe('vextrus/no-forbidden-escapes disable-comment family', () => {
  // AC-06 token 4 + AC-12: every disable-comment variant fires exactly once.
  const variants: [string, string][] = [
    ['block, whole file', `/* ${ESLINT_DISABLE} */\nconst a = 1;`],
    ['line, next-line', `// ${ESLINT_DISABLE}-next-line no-console\nconst b = 1;`],
    ['trailing, this line', `const c = 1; // ${ESLINT_DISABLE}-line`],
    ['block, next-line', `/* ${ESLINT_DISABLE}-next-line no-console */\nconst d = 1;`],
    ['block, whole file, with rule list', `/* ${ESLINT_DISABLE} no-console */\nconst e = 1;`],
  ];
  for (const [label, code] of variants) {
    it(`fires on ${label}`, () => {
      expect(reportsFor(code)).toHaveLength(1);
    });
  }

  // AC-12: the substring in a string literal or identifier must not fire.
  it('does not fire on the substring in data or identifiers', () => {
    expect(reportsFor(`const note = "never write ${ESLINT_DISABLE} in source";`)).toHaveLength(0);
    expect(reportsFor(`const ${ESLINT_DISABLE.replace('-', '_')}d = false;`)).toHaveLength(0);
  });
});

run('no-forbidden-escapes', rule, {
  valid: [
    // AC-12: identifiers and strings that merely contain a token do not fire.
    { code: `const company = "${ANY}where";` },
    { code: `const nav = { ${SKIP}Link: true };` },
    { code: `const data = { mode: ".${ONLY}" };` },
    { code: `const has = [1, 2].some((n) => n > 1);` },
    { code: `type Company = { ${ANY}way: string };` },
    { code: `const ${SKIP}ped = true;` },
    { code: `const ${ONLY} = 1;` },
    { code: `const company = { name: "${ANY}thing" }; const n = company.name;` },
    // A prose comment that merely mentions a token is not a directive.
    { code: `// we ban ${TS_IGNORE} in this codebase\nconst ok = 1;` },
  ],
  invalid: [
    // AC-06 token 1: `any` as a type annotation.
    { code: `const x: ${ANY} = 1;`, errors: 1 },
    { code: `function f(v: ${ANY}) { return v; }`, errors: 1 },
    // AC-06 token 2: the TypeScript ignore directive, line and block forms.
    { code: `// ${TS_IGNORE}\nconst y = 1;`, errors: 1 },
    { code: `/* ${TS_IGNORE} */\nconst y2 = 1;`, errors: 1 },
    // AC-06 token 3: the TypeScript expect-error directive.
    { code: `// ${TS_EXPECT_ERROR}\nconst z = 1;`, errors: 1 },
    { code: `/* ${TS_EXPECT_ERROR} */\nconst z2 = 1;`, errors: 1 },
    // AC-06 token 5 + AC-12: `.skip` as a test-call modifier.
    { code: `describe.${SKIP}("suite", () => {});`, errors: 1 },
    { code: `it.${SKIP}("case", () => {});`, errors: 1 },
    // AC-06 token 6 + AC-12: `.only` as a test-call modifier.
    { code: `it.${ONLY}("case", () => {});`, errors: 1 },
    { code: `test.${ONLY}("case", () => {});`, errors: 1 },
    { code: `describe.${ONLY}("suite", () => {});`, errors: 1 },
  ],
});
