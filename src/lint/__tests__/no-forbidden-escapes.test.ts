/**
 * AC-06 — every one of the six Q-08 tokens is reported by
 * `vextrus/no-forbidden-escapes`. Q-01: "every guardrail rule has a fixture
 * test proving it fires."
 *
 * AC-13: the forbidden tokens are assembled from fragments and only ever exist
 * inside string fixtures, so `eslint .` over this repo stays green and vitest
 * never sees a real `.only`/`.skip` modifier here.
 */
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, expect, it } from 'vitest';
import { rule, files, severity } from '../rules/no-forbidden-escapes';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ANY = 'an' + 'y';
const TS_IGNORE = '@' + 'ts-ignore';
const TS_EXPECT_ERROR = '@' + 'ts-expect-error';
const ESLINT_DISABLE = 'eslint' + '-disable';
const SKIP = '.' + 'skip';
const ONLY = '.' + 'only';

const ruleTester = new RuleTester({
  languageOptions: { parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
});

describe('AC-06 vextrus/no-forbidden-escapes fires for each Q-08 token', () => {
  it('declares the registration metadata the loader expects', () => {
    expect(files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(severity).toBe('error');
    expect(typeof rule.create).toBe('function');
  });

  ruleTester.run('no-forbidden-escapes', rule, {
    valid: [
      // AC-12 (public smoke): substrings inside identifiers and strings are not escapes
      { code: 'export const company = "anywhere";' },
      { code: 'export const nav = { skipLink: true };' },
      { code: `export const marker = "${ONLY}";` },
      { code: 'export const positive = [1, 2].some((n) => n > 0);' },
    ],
    invalid: [
      // `any` as a type annotation
      { code: `export const escape: ${ANY} = 1;`, errors: 1 },
      // @ts-ignore
      { code: `// ${TS_IGNORE}\nexport const a = 1;`, errors: 1 },
      // @ts-expect-error
      { code: `// ${TS_EXPECT_ERROR}\nexport const b = 1;`, errors: 1 },
      // eslint-disable, all comment variants
      { code: `/* ${ESLINT_DISABLE} */\nexport const c = 1;`, errors: 1 },
      { code: `// ${ESLINT_DISABLE}-next-line no-console\nexport const d = 1;`, errors: 1 },
      { code: `/* ${ESLINT_DISABLE}-next-line no-console */\nexport const e = 1;`, errors: 1 },
      // .skip / .only as test-call modifiers
      { code: `it${SKIP}("x", () => {});`, errors: 1 },
      { code: `describe${SKIP}("x", () => {});`, errors: 1 },
      { code: `it${ONLY}("x", () => {});`, errors: 1 },
      { code: `test${ONLY}("x", () => {});`, errors: 1 },
    ],
  });
});
