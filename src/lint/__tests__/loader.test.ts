/**
 * The custom lint-rule loader: auto-discovery, not a hand-maintained list.
 *
 * Proves: B-05 (guardrails are mechanical), B-03 (one lane, zero codegen) and
 * AC-06 — every later increment adds a rule file only, never editing
 * eslint.config.ts.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadRules } from '../loader';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const RULES_DIR = path.join(ROOT, 'src', 'lint', 'rules');

function ruleFileNames(): string[] {
  return readdirSync(RULES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.slice(0, -'.ts'.length))
    .sort();
}

describe('loadRules', () => {
  // AC-06: discovery is by directory listing, so names match files exactly.
  it('AC-06: registers exactly one rule per src/lint/rules/*.ts file', () => {
    const registrations = loadRules();
    expect(registrations.map((r) => r.name).sort()).toEqual(ruleFileNames());
    expect(registrations.length).toBeGreaterThan(0);
  });

  // Interfaces: RuleRegistration = { name, rule, files, severity }.
  it('AC-06: every registration carries a rule, a files glob list and a severity', () => {
    for (const registration of loadRules()) {
      expect(typeof registration.name).toBe('string');
      expect(typeof registration.rule.create).toBe('function');
      expect(Array.isArray(registration.files)).toBe(true);
      expect(registration.files.length).toBeGreaterThan(0);
      expect(['error', 'warn']).toContain(registration.severity);
    }
  });

  // Q-08 · AC-06: the first real rule is discovered with its declared shape.
  it('AC-06: discovers no-forbidden-escapes with its module-declared shape', () => {
    const found = loadRules().find((r) => r.name === 'no-forbidden-escapes');
    expect(found).toBeDefined();
    expect(found?.files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(found?.severity).toBe('error');
  });
});

describe('eslint.config.ts', () => {
  const configPath = path.join(ROOT, 'eslint.config.ts');
  const readConfig = (): string => readFileSync(configPath, 'utf8');

  // AC-06: the shared config file must never name a rule file — that is the
  // whole point of the loader (B-03: later increments extend without editing
  // shared files).
  it('AC-06: consumes the loader and names no individual rule file', () => {
    expect(existsSync(configPath)).toBe(true);
    const source = readConfig();
    expect(source).toMatch(/loadRules/);
    expect(source).not.toMatch(/no-forbidden-escapes/);
    expect(source).not.toMatch(/lint\/rules\//);
  });

  // Q-08: an `eslint-disable` comment must not be able to switch off the rule
  // that bans it, so inline directives carry no authority in this repo.
  it('AC-12: denies inline directives any authority (noInlineConfig)', () => {
    expect(readConfig()).toMatch(/noInlineConfig/);
  });

  // Interfaces: plugin namespace `vextrus`, so rule ids read
  // `vextrus/<rule-name>` in eslint output (AC-05).
  it('AC-05: registers the discovered rules under the `vextrus` plugin namespace', () => {
    expect(readConfig()).toMatch(/vextrus/);
  });
});
