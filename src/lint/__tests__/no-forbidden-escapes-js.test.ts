/**
 * Fixture test for the plain-JavaScript registration of the Q-08 guardrail
 * (Q-01: every guardrail rule has a fixture test proving it fires).
 *
 * The drop-in runners and their fixture tests are `.mjs`, and `pnpm test`
 * executes `scripts/**\/*.test.mjs`. A test surface the guardrail cannot read is
 * a surface where a suite modifier shrinks the run with `pnpm verify` still
 * green, so the registration is checked here on JavaScript source — parsed by
 * the default parser, the way `eslint .` parses those files — not only on the
 * TypeScript source its sibling covers.
 *
 * Every forbidden token is assembled from fragments, as the rule's own fixtures
 * are (risk note 1): spelled out, this file would fail the rule it proves.
 */
import { Linter } from 'eslint';
import { describe, expect, test } from 'vitest';

import { loadRules } from '../loader';
import { files, rule, severity } from '../rules/no-forbidden-escapes-js';
import { rule as tsRule } from '../rules/no-forbidden-escapes';

const linter = new Linter();

/** Lints `code` as the JavaScript file `filename` with only this rule turned on. */
function lint(code: string, filename = 'scripts/probe.mjs'): Linter.LintMessage[] {
  return linter.verify(
    code,
    {
      plugins: { vextrus: { rules: { 'no-forbidden-escapes-js': rule } } },
      rules: { 'vextrus/no-forbidden-escapes-js': 'error' },
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
      languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    filename,
  );
}

const messageIds = (code: string, filename?: string): string[] =>
  lint(code, filename).map((message) => message.messageId ?? '');

describe('the JavaScript surface carries the same Q-08 guardrail', () => {
  test('it registers the same rule over the .mjs/.cjs/.js globs', () => {
    expect(rule).toBe(tsRule);
    expect(files).toEqual(['**/*.mjs', '**/*.cjs', '**/*.js']);
    expect(severity).toBe('error');
  });

  test('the loader discovers it, so eslint.config.ts names nothing', () => {
    const found = loadRules().find((r) => r.name === 'no-forbidden-escapes-js');

    expect(found).toBeDefined();
    expect(found?.files).toEqual(['**/*.mjs', '**/*.cjs', '**/*.js']);
    expect(found?.severity).toBe('error');
  });

  test('a lint suppression comment in a runner is an error', () => {
    expect(messageIds(`// eslint-${'disable'}\nexport const value = 1;\n`)).toEqual([
      'lintSuppression',
    ]);
    // `noInlineConfig` also files its own report for a directive comment, and it
    // carries no messageId — the rule's own report is what this asserts on.
    expect(
      messageIds(`export const value = 1; // eslint-${'disable'}-next-line no-console\n`),
    ).toContain('lintSuppression');
  });

  test('a compiler suppression comment in a runner is an error', () => {
    expect(messageIds(`// @ts-${'ignore'}\nexport const value = 1;\n`)).toEqual([
      'compilerSuppression',
    ]);
    expect(messageIds(`// @ts-${'expect'}-error\nexport const value = 1;\n`)).toEqual([
      'compilerSuppression',
    ]);
  });

  test('a suite modifier in an .mjs fixture test is an error', () => {
    const code =
      `import { test } from 'vitest';\n` +
      `test.${'on' + 'ly'}('case', () => undefined);\n` +
      `test.${'sk' + 'ip'}('other', () => undefined);\n`;

    expect(messageIds(code, 'scripts/lib/__tests__/probe.test.mjs')).toEqual([
      'testModifier',
      'testModifier',
    ]);
  });

  test('ordinary runner code is left alone', () => {
    const code =
      `import { readdirSync } from 'node:fs';\n` +
      `export const steps = (dir) => readdirSync(dir).filter((f) => f.endsWith('.mjs'));\n` +
      `export const first = (list) => list.at(0);\n`;

    expect(messageIds(code)).toEqual([]);
  });
});
