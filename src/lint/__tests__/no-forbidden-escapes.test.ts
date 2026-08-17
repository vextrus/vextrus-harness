import { RuleTester } from '@typescript-eslint/rule-tester';
import tseslint from 'typescript-eslint';
import * as vitest from 'vitest';

import { rule, files, severity } from '../rules/no-forbidden-escapes';

// The rule's own fixtures contain the very tokens the rule forbids. They are
// assembled from fragments at runtime so that `eslint .` over this repo stays
// green and vitest never sees a real `.only` / `.skip` modifier. (AC-13, Q-08)
const AT_TS = `@${'ts'}-`;
const TS_IGNORE = `${AT_TS}ignore`;
const TS_EXPECT_ERROR = `${AT_TS}expect-error`;
const ESLINT_DISABLE = `eslint-${'disable'}`;
const ANY = `a${'ny'}`;
const ONLY = `.${'only'}`;
const SKIP = `.${'skip'}`;

RuleTester.afterAll = vitest.afterAll;
RuleTester.it = vitest.it;
RuleTester.describe = vitest.describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

// Q-08 / AC-06: each of the six forbidden escapes is an error.
ruleTester.run('vextrus/no-forbidden-escapes', rule, {
  valid: [
    // AC-12 (public half): substrings alone are not escapes.
    { code: `const company = "an${'ywhere'}";` },
    { code: `const nav = { skipLink: true };` },
    { code: `export const total = [1, 2].some((n) => n > 1);` },
  ],
  invalid: [
    // Q-08: no `any`
    { code: `export function f(x: ${ANY}) { return x; }`, errors: 1 },
    // Q-08: no @ts-ignore
    { code: `// ${TS_IGNORE}\nexport const a = 1;`, errors: 1 },
    // Q-08: no @ts-expect-error
    { code: `// ${TS_EXPECT_ERROR}\nexport const b = 1;`, errors: 1 },
    // Q-08: no eslint-disable (line comment form)
    { code: `// ${ESLINT_DISABLE}-next-line\nexport const c = 1;`, errors: 1 },
    // Q-08: no eslint-disable (block comment form)
    { code: `/* ${ESLINT_DISABLE} */\nexport const d = 1;`, errors: 1 },
    // Q-08: no .skip
    { code: `describe${SKIP}('x', () => {});`, errors: 1 },
    // Q-08: no .only
    { code: `it${ONLY}('x', () => {});`, errors: 1 },
  ],
});

vitest.describe('no-forbidden-escapes module contract', () => {
  // Interface contract: the loader reads `{ rule, files, severity }`.
  vitest.it('exports the registration shape the loader expects', () => {
    vitest.expect(files).toEqual(['**/*.ts', '**/*.tsx']);
    vitest.expect(severity).toBe('error');
    vitest.expect(typeof rule.create).toBe('function');
  });
});
