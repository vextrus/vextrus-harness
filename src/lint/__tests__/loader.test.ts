import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRules } from '../loader';

const RULES_DIR = join(process.cwd(), 'src', 'lint', 'rules');

function ruleFileNames(): string[] {
  return readdirSync(RULES_DIR)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => entry.replace(/\.ts$/, ''))
    .sort();
}

describe('src/lint/loader — auto-discovery (AC-06)', () => {
  it('registers exactly the modules found in src/lint/rules/*.ts', () => {
    // The loader is what lets later increments add a rule without editing a
    // shared file — so its input is the directory, never a hand-kept list.
    const registrations = loadRules();
    expect(Array.isArray(registrations)).toBe(true);
    expect(registrations.map((registration) => registration.name).sort()).toEqual(ruleFileNames());
  });

  it('carries each module\'s { rule, files, severity } through unchanged', () => {
    for (const registration of loadRules()) {
      expect(typeof registration.rule.create).toBe('function');
      expect(Array.isArray(registration.files)).toBe(true);
      expect(registration.files.length).toBeGreaterThan(0);
      expect(['error', 'warn']).toContain(registration.severity);
    }
  });

  it('includes the first real rule under its contract name', () => {
    const found = loadRules().find((registration) => registration.name === 'no-forbidden-escapes');
    expect(found).toBeDefined();
    expect(found?.files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(found?.severity).toBe('error');
  });

  it('is driven by the directory, not by eslint.config.ts (B-03: zero shared-file churn)', () => {
    const config = readFileSync(join(process.cwd(), 'eslint.config.ts'), 'utf8');
    expect(config).toContain('loadRules');
    expect(config).not.toContain('no-forbidden-escapes');
  });
});
