/**
 * The loader is the reason a later increment adds a guardrail without editing a
 * shared file: it lists a directory instead of naming rules.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { loadRules, PLUGIN_NAMESPACE } from '../loader';

/**
 * Probe rule files go into a scratch directory, never into `src/lint/rules/`.
 * That directory is live: `eslint.config.ts` calls `loadRules()` at load time, so
 * a probe left behind by an interrupted run (Ctrl-C, OOM kill, timeout) would
 * make `pnpm lint` and every `pnpm verify` fail with a config-load error until a
 * human found the file — and while the probe exists it races any concurrent
 * `eslint .` or editor lint server. `loadRules(directory)` exists for exactly
 * this: discovery is a directory listing, so pointing it at a scratch directory
 * proves the same thing without touching the tree.
 */
const scratchRulesDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'vextrus-lint-rules-'));
  return dir;
};

test('the shipped rules are discovered with a well-formed registration', () => {
  const registrations = loadRules();

  expect(registrations.length).toBeGreaterThan(0);
  for (const registration of registrations) {
    expect(registration.name).toMatch(/^[a-z0-9-]+$/);
    expect(typeof registration.rule.create).toBe('function');
    expect(registration.files.length).toBeGreaterThan(0);
    expect(['error', 'warn']).toContain(registration.severity);
  }
});

test('a rule file dropped into the directory is registered with no edit anywhere', () => {
  const directory = scratchRulesDir();
  writeFileSync(
    join(directory, 'loader-fixture-probe.ts'),
    [
      "import type { Rule } from 'eslint';",
      '',
      'export const rule: Rule.RuleModule = { create: () => ({}) };',
      "export const files = ['**/*.ts'];",
      "export const severity = 'warn' as const;",
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    const probe = loadRules(directory).find((r) => r.name === 'loader-fixture-probe');

    expect(probe).toBeDefined();
    expect(probe?.files).toEqual(['**/*.ts']);
    expect(probe?.severity).toBe('warn');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a malformed rule file is rejected loudly rather than silently skipped', () => {
  const directory = scratchRulesDir();
  writeFileSync(join(directory, 'loader-broken-probe.ts'), 'export const files = 1;\n', 'utf8');
  try {
    expect(() => loadRules(directory)).toThrow(/loader-broken-probe/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the rules are registered under the vextrus plugin namespace', () => {
  expect(PLUGIN_NAMESPACE).toBe('vextrus');
});

test('test fixture files in the rules directory are not mistaken for rules', () => {
  expect(loadRules().map((r) => r.name)).not.toContain('no-forbidden-escapes.spec');
});
