/**
 * Acceptance for the custom lint-rule loader (AC-06).
 *
 * The loader must auto-discover `src/lint/rules/*.ts`, so `eslint.config.ts`
 * never names a rule file and later increments add rules by dropping in a file.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';

import { loadRules } from './loader';

const repoRoot = process.cwd();
const rulesDir = join(repoRoot, 'src', 'lint', 'rules');

// AC-06: the loader discovers the shipped rule and registers its
// { rule, files, severity } triple under the plugin's own name.
test('loadRules discovers no-forbidden-escapes with its registration triple', () => {
  const registrations = loadRules();
  const found = registrations.find((r) => r.name === 'no-forbidden-escapes');

  expect(found).toBeDefined();
  expect(found?.files).toEqual(['**/*.ts', '**/*.tsx']);
  expect(found?.severity).toBe('error');
  expect(typeof found?.rule.create).toBe('function');
});

// AC-06: every registration is well-formed — the registry is data the ESLint
// flat config can spread without per-rule knowledge.
test('every registration carries a name, a rule, file globs and a severity', () => {
  const registrations = loadRules();

  expect(registrations.length).toBeGreaterThan(0);
  for (const registration of registrations) {
    expect(registration.name).toMatch(/^[a-z0-9-]+$/);
    expect(typeof registration.rule.create).toBe('function');
    expect(Array.isArray(registration.files)).toBe(true);
    expect(registration.files.length).toBeGreaterThan(0);
    expect(['error', 'warn']).toContain(registration.severity);
  }
});

// AC-06: discovery is by directory listing, not by a hardcoded list — a new
// rule file is picked up with no edit to the loader or to eslint.config.ts.
test('a rule file dropped into src/lint/rules is discovered without any edit', async () => {
  const dropInPath = join(rulesDir, 'acceptance-dropin-probe.ts');
  const dropInSource = [
    "import type { Rule } from 'eslint';",
    '',
    'export const rule: Rule.RuleModule = { create: () => ({}) };',
    "export const files = ['**/*.ts'];",
    "export const severity = 'error' as const;",
    '',
  ].join('\n');

  writeFileSync(dropInPath, dropInSource, 'utf8');
  try {
    vi.resetModules();
    const fresh = await import('./loader');
    const names = fresh.loadRules().map((r) => r.name);
    expect(names).toContain('acceptance-dropin-probe');
    expect(names).toContain('no-forbidden-escapes');
  } finally {
    rmSync(dropInPath, { force: true });
    vi.resetModules();
  }
});

// AC-06: eslint.config.ts must not name any rule file or rule id; it consumes
// the loader and exposes the rules under the `vextrus` plugin namespace.
test('eslint.config.ts wires the loader and names no rule file', () => {
  const config = readFileSync(join(repoRoot, 'eslint.config.ts'), 'utf8');

  expect(config).toMatch(/loadRules/);
  expect(config).toMatch(/vextrus/);
  expect(config).not.toMatch(/no-forbidden-escapes/);
  expect(config).not.toMatch(/rules\/[a-z0-9-]+['"`]/);
});

// AC-06: the loader itself stays generic — no rule name baked into its source.
test('loader.ts hardcodes no rule name', () => {
  const loaderSource = readFileSync(join(repoRoot, 'src', 'lint', 'loader.ts'), 'utf8');

  expect(loaderSource).not.toMatch(/no-forbidden-escapes/);
});
