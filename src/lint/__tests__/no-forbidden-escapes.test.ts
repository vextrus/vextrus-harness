// AC-06 / Q-08 — RuleTester fixtures proving each of the six forbidden escape
// tokens is reported as an error by `vextrus/no-forbidden-escapes`.
//
// AC-13: every forbidden token below is assembled by concatenation and lives
// only inside fixture *strings*. Nothing in this file is a literal escape, so
// `eslint .` over the repo stays green and vitest never sees a real modifier.
import type { Rule } from 'eslint';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { parser } from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';

import { rule, files, severity } from '../rules/no-forbidden-escapes';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

type TsRule = Parameters<RuleTester['run']>[1];
const asTsRule = (candidate: Rule.RuleModule): TsRule => candidate as unknown as TsRule;

const AT = '@';
const TS_IGNORE = `${AT}ts-` + 'ignore';
const TS_EXPECT_ERROR = `${AT}ts-` + 'expect-error';
const ESLINT_DISABLE = 'eslint-' + 'disable';
const ESLINT_DISABLE_NEXT_LINE = `${ESLINT_DISABLE}-next-line`;
const ANY = 'an' + 'y';
const SKIP = 'sk' + 'ip';
const ONLY = 'on' + 'ly';

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

describe('vextrus/no-forbidden-escapes', () => {
  // Q-08 — the rule module must declare the shape the loader registers (AC-06).
  it('exports the rule registration shape the loader expects', () => {
    if (typeof rule.create !== 'function') {
      throw new Error('expected `rule` to be an ESLint rule module with a create()');
    }
    if (JSON.stringify(files) !== JSON.stringify(['**/*.ts', '**/*.tsx'])) {
      throw new Error(`expected files to be ['**/*.ts','**/*.tsx'], got ${JSON.stringify(files)}`);
    }
    if (severity !== 'error') {
      throw new Error(`expected severity 'error', got ${String(severity)}`);
    }
  });
});

ruleTester.run('no-forbidden-escapes', asTsRule(rule), {
  valid: [
    // Q-08 — the rule targets escapes, not innocent code that merely reads similarly.
    { code: 'export const total: number = 1;' },
    { code: 'export const ok = [1, 2, 3].some((n) => n > 1);' },
    { code: 'export function nothing(): void {}' },
  ],
  invalid: [
    {
      // Q-08 — explicit `any` type annotation.
      code: `export const loose: ${ANY} = 1;`,
      errors: 1,
    },
    {
      // Q-08 — TypeScript ignore directive.
      code: `// ${TS_IGNORE}\nexport const value = 1;`,
      errors: 1,
    },
    {
      // Q-08 — TypeScript expect-error directive.
      code: `// ${TS_EXPECT_ERROR}\nexport const value = 1;`,
      errors: 1,
    },
    {
      // Q-08 — line-comment eslint suppression.
      code: `/* ${ESLINT_DISABLE} */\nexport const value = 1;`,
      errors: 1,
    },
    {
      // Q-08 — next-line variant of the eslint suppression.
      code: `// ${ESLINT_DISABLE_NEXT_LINE} no-console\nexport const value = 1;`,
      errors: 1,
    },
    {
      // Q-08 — skipped test modifier.
      code: `describe.${SKIP}('suite', () => {});`,
      errors: 1,
    },
    {
      // Q-08 — focused test modifier.
      code: `it.${ONLY}('case', () => {});`,
      errors: 1,
    },
  ],
});
