/**
 * Acceptance for AC-06 (loader half) — Bible B-03: zero codegen, one lane.
 *
 * The loader is what lets every later increment add a guardrail rule by
 * dropping a file into `src/lint/rules/` without editing any shared file.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadRules } from '../loader';
import type { RuleRegistration } from '../loader';

const repoRoot = process.cwd();
const rulesDir = path.join(repoRoot, 'src', 'lint', 'rules');

/** Rule module basenames present on disk, which the loader must discover. */
function ruleFilesOnDisk(): string[] {
  return readdirSync(rulesDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

describe('src/lint/loader', () => {
  // AC-06: auto-discovery of src/lint/rules/*.ts.
  it('discovers every rule module on disk, and nothing else', () => {
    const registrations: RuleRegistration[] = loadRules();
    const registered = registrations.map((r) => r.name).sort();
    expect(registered).toEqual(ruleFilesOnDisk());
    expect(registered.length).toBeGreaterThan(0);
  });

  // AC-06: each module's { rule, files, severity } is carried through verbatim.
  it('registers no-forbidden-escapes with its files and severity', () => {
    const registration = loadRules().find((r) => r.name === 'no-forbidden-escapes');
    expect(registration).toBeDefined();
    if (registration === undefined) return;
    expect(registration.files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(registration.severity).toBe('error');
    expect(typeof registration.rule.create).toBe('function');
  });

  // AC-06: every registration is well formed, so a new rule file cannot be
  // half-registered by a later increment.
  it('returns a complete registration for every discovered rule', () => {
    for (const registration of loadRules()) {
      expect(registration.name).toMatch(/^[a-z0-9-]+$/);
      expect(Array.isArray(registration.files)).toBe(true);
      expect(registration.files.length).toBeGreaterThan(0);
      expect(['error', 'warn']).toContain(registration.severity);
      expect(typeof registration.rule.create).toBe('function');
    }
  });

  // AC-06: "without eslint.config.ts naming any rule file".
  it('leaves eslint.config.ts free of any individual rule name', () => {
    const configPath = path.join(repoRoot, 'eslint.config.ts');
    expect(existsSync(configPath)).toBe(true);
    const config = readFileSync(configPath, 'utf8');
    for (const name of ruleFilesOnDisk()) {
      expect(config).not.toContain(name);
    }
    expect(config).not.toContain('rules/');
  });
});
