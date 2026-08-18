/**
 * The loader is the reason a later increment adds a guardrail without editing a
 * shared file: it lists a directory instead of naming rules.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { loadRules, PLUGIN_NAMESPACE } from '../loader';

const rulesDir = join(process.cwd(), 'src', 'lint', 'rules');

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
  const probePath = join(rulesDir, 'loader-fixture-probe.ts');
  writeFileSync(
    probePath,
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
    const probe = loadRules().find((r) => r.name === 'loader-fixture-probe');

    expect(probe).toBeDefined();
    expect(probe?.files).toEqual(['**/*.ts']);
    expect(probe?.severity).toBe('warn');
  } finally {
    rmSync(probePath, { force: true });
  }
});

test('a malformed rule file is rejected loudly rather than silently skipped', () => {
  const brokenPath = join(rulesDir, 'loader-broken-probe.ts');
  writeFileSync(brokenPath, 'export const files = 1;\n', 'utf8');
  try {
    expect(() => loadRules()).toThrow(/loader-broken-probe/);
  } finally {
    rmSync(brokenPath, { force: true });
  }
});

test('the rules are registered under the vextrus plugin namespace', () => {
  expect(PLUGIN_NAMESPACE).toBe('vextrus');
});

test('test fixture files in the rules directory are not mistaken for rules', () => {
  expect(loadRules().map((r) => r.name)).not.toContain('no-forbidden-escapes.spec');
});
