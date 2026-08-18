/**
 * Breaker: Q-08 says the suite-shrinking modifiers are forbidden. The rule as
 * shipped only looks at `MemberExpression` nodes whose root identifier resolves
 * to a test callee, so two ordinary spellings walk straight past it:
 *
 *   1. destructuring the modifier off the callee — `const { only } = it`
 *   2. a namespace import of the runner — `import * as vt from 'vitest'`
 *
 * Both really do shrink the suite (proved against vitest itself, below), and
 * both leave `eslint .` green, which is exactly the failure mode Q-08 exists to
 * prevent: a suite that does not run while `pnpm verify` says it does.
 *
 * Every forbidden token is assembled from fragments so this file survives the
 * repo's own `eslint .` (risk note 1 / AC-13).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, expect, it } from 'vitest';

import { rule } from '../../src/lint/rules/no-forbidden-escapes';
import { runCli } from './support/cli';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ONLY = `${'on'}ly`;
const SKIP = `${'sk'}ip`;

const ruleTester = new RuleTester();
const underTest = rule as unknown as Parameters<typeof ruleTester.run>[1];

describe('vextrus/no-forbidden-escapes — modifier bypasses', () => {
  ruleTester.run('no-forbidden-escapes', underTest, {
    valid: [],
    invalid: [
      {
        // Destructuring: the modifier is lifted off the callee, so no
        // MemberExpression naming it ever reaches the rule.
        name: 'destructured modifier off a test callee',
        code: [
          `import { it } from 'vitest';`,
          `const { ${ONLY} } = it;`,
          `${ONLY}('this one runs, the rest do not', () => {});`,
        ].join('\n'),
        errors: [{ messageId: 'testModifier' }],
      },
      {
        name: 'destructured skip off a test callee',
        code: [
          `import { describe } from 'vitest';`,
          `const { ${SKIP} } = describe;`,
          `${SKIP}('parked suite', () => {});`,
        ].join('\n'),
        errors: [{ messageId: 'testModifier' }],
      },
      {
        // Namespace import: the root identifier resolves to an
        // ImportNamespaceSpecifier, which `isTestCallee` answers `false` for.
        name: 'modifier reached through a namespace import of the runner',
        code: [`import * as vt from 'vitest';`, `vt.it.${ONLY}('the only one', () => {});`].join(
          '\n',
        ),
        errors: [{ messageId: 'testModifier' }],
      },
      {
        name: 'skip reached through a namespace import of the runner',
        code: [`import * as vt from 'vitest';`, `vt.describe.${SKIP}('parked', () => {});`].join(
          '\n',
        ),
        errors: [{ messageId: 'testModifier' }],
      },
    ],
  });
});

/**
 * The rule-level proof above is only worth having because the bypass is real:
 * vitest honours both spellings and silently drops the other cases.
 */
describe('the bypass really shrinks the suite', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'vextrus-bypass-'));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const runVitest = (fileName: string, source: string): string => {
    const file = join(scratch, fileName);
    writeFileSync(file, source, 'utf8');
    const result = runCli(
      join(process.cwd(), 'node_modules', '.bin', 'vitest'),
      ['run', '--no-cache', '--root', scratch, file],
      { CI: '1' },
    );
    return result.output;
  };

  it('drops cases when the modifier is destructured off the callee', () => {
    const output = runVitest(
      'destructured.spec.ts',
      [
        `import { describe, it, expect } from 'vitest';`,
        `const { ${ONLY} } = it;`,
        `describe('suite', () => {`,
        `  it('A', () => { expect(1).toBe(1); });`,
        `  it('B', () => { expect(1).toBe(1); });`,
        `  ${ONLY}('C', () => { expect(1).toBe(1); });`,
        `});`,
        '',
      ].join('\n'),
    );
    expect(output).toMatch(/\bskipped\b/);
  });

  it('drops cases when the modifier is reached through a namespace import', () => {
    const output = runVitest(
      'namespaced.spec.ts',
      [
        `import * as vt from 'vitest';`,
        `vt.describe('suite', () => {`,
        `  vt.it('A', () => { vt.expect(1).toBe(1); });`,
        `  vt.it.${ONLY}('B', () => { vt.expect(1).toBe(1); });`,
        `});`,
        '',
      ].join('\n'),
    );
    expect(output).toMatch(/\bskipped\b/);
  });
});
