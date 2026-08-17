/**
 * AC-06 (loader half) — `loadRules()` auto-discovers `src/lint/rules/*.ts`, so
 * later increments add a guardrail by dropping in a file, never by editing
 * `eslint.config.ts` (B-03: shared files are not edited by every increment).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRules, type RuleRegistration } from '../loader';

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesDir = path.join(here, '..', 'rules');
const repoRoot = path.resolve(here, '..', '..', '..');

const ruleFileNames = (): string[] =>
  readdirSync(rulesDir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();

describe('AC-06 lint rule loader', () => {
  it('discovers every module in src/lint/rules and registers nothing else', async () => {
    const registrations: RuleRegistration[] = await loadRules();
    expect(registrations.map((registration) => registration.name).sort()).toEqual(ruleFileNames());
  });

  it('registers each module as { name, rule, files, severity }', async () => {
    const registrations = await loadRules();
    expect(registrations.length).toBeGreaterThan(0);
    for (const registration of registrations) {
      expect(typeof registration.name).toBe('string');
      expect(typeof registration.rule.create).toBe('function');
      expect(Array.isArray(registration.files)).toBe(true);
      expect(registration.files.length).toBeGreaterThan(0);
      expect(['error', 'warn']).toContain(registration.severity);
    }
  });

  it('includes no-forbidden-escapes with the contracted metadata', async () => {
    const registrations = await loadRules();
    const found = registrations.find((registration) => registration.name === 'no-forbidden-escapes');
    expect(found, 'no-forbidden-escapes was not discovered').toBeDefined();
    expect(found?.files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(found?.severity).toBe('error');
  });

  it('eslint.config.ts names no individual rule file — discovery is the only wiring', () => {
    const config = readFileSync(path.join(repoRoot, 'eslint.config.ts'), 'utf8');
    expect(config).toMatch(/loadRules/);
    for (const name of ruleFileNames()) {
      expect(config, `eslint.config.ts hard-codes the rule file "${name}"`).not.toContain(name);
    }
  });

  it('exposes the rules under the vextrus plugin namespace', async () => {
    const registrations = await loadRules();
    const config = readFileSync(path.join(repoRoot, 'eslint.config.ts'), 'utf8');
    expect(config).toMatch(/vextrus/);
    expect(registrations.some((registration) => registration.name === 'no-forbidden-escapes')).toBe(true);
  });
});
