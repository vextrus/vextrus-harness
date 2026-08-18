/**
 * Q-01: every firing path of a guardrail rule has a fixture proving it fires.
 *
 * This one covers the discrimination `no-forbidden-escapes` makes between a
 * runner global and an ordinary word. `context` and `bench` are ordinary words,
 * so an undeclared one in application code cannot be condemned on its name —
 * but inside a test file an undeclared `context` is exactly the globals-enabled
 * runner's injection, and `context.only(...)` shrinks the suite silently, which
 * is the failure Q-08 forbids. The file being linted decides, not the name.
 *
 * The forbidden tokens are assembled from fragments so this file itself survives
 * the repo's own `eslint .` (AC-13 / risk note 1).
 */
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { rule } from '../rules/no-forbidden-escapes';

const RULE_ID = 'vextrus/no-forbidden-escapes';
const SKIP = `${'sk'}ip`;
const ONLY = `${'on'}ly`;

const linter = new Linter();

const reportsIn = (filename: string, code: string): Linter.LintMessage[] =>
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
      filename,
    )
    .filter((message) => message.ruleId === RULE_ID);

const messageIdsIn = (filename: string, code: string): string[] =>
  reportsIn(filename, code).map((message) => message.messageId ?? '');

describe('a runner global that is also an ordinary word', () => {
  it.each([
    { label: 'a .test.ts file', filename: 'src/feature/suite.test.ts' },
    { label: 'a .spec.ts file', filename: 'tests/acceptance/thing.spec.ts' },
    { label: 'a file under __tests__', filename: 'src/lint/__tests__/thing.ts' },
  ])('$label reports an undeclared context modifier', ({ filename }) => {
    expect(messageIdsIn(filename, `context.${ONLY}('suite', () => {});`)).toEqual(['testModifier']);
  });

  it('reports an undeclared bench modifier in a benchmark file', () => {
    expect(messageIdsIn('src/perf/thing.bench.ts', `bench.${SKIP}('case', () => {});`)).toEqual([
      'testModifier',
    ]);
  });

  it.each([
    { label: 'context in application code', code: `export const held: unknown = context.${SKIP};` },
    { label: 'bench in application code', code: `export const held: unknown = bench.${ONLY};` },
  ])('$label is left alone', ({ code }) => {
    expect(reportsIn('src/domain/module.ts', code)).toEqual([]);
  });

  it('still reports the unambiguous openers in application code', () => {
    expect(messageIdsIn('src/domain/module.ts', `describe.${SKIP}('suite', () => {});`)).toEqual([
      'testModifier',
    ]);
  });
});
