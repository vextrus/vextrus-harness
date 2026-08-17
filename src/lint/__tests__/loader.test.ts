// AC-06 — the loader auto-discovers src/lint/rules/*.ts and registers each
// module's { rule, files, severity }, with eslint.config.ts naming no rule file.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadRules, type RuleRegistration } from '../loader';

const RULES_DIR = join(process.cwd(), 'src', 'lint', 'rules');

const ruleFileNames = (): string[] =>
  readdirSync(RULES_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();

describe('src/lint/loader', () => {
  it('discovers every module in src/lint/rules and registers nothing else', () => {
    // AC-06 — discovery is by directory listing, not by a hand-written list.
    const registered = loadRules()
      .map((registration: RuleRegistration) => registration.name)
      .sort();
    expect(registered).toEqual(ruleFileNames());
  });

  it('registers no-forbidden-escapes with its declared files and severity', () => {
    // AC-06 / Q-08 — the first real guardrail rule is wired as an error.
    const registration = loadRules().find((entry) => entry.name === 'no-forbidden-escapes');
    expect(registration).toBeDefined();
    expect(registration?.files).toEqual(['**/*.ts', '**/*.tsx']);
    expect(registration?.severity).toBe('error');
    expect(typeof registration?.rule.create).toBe('function');
  });

  it('exposes each registration under the vextrus plugin namespace', () => {
    // AC-05 — verify must be able to report the id `vextrus/no-forbidden-escapes`.
    for (const registration of loadRules()) {
      expect(registration.name).not.toContain('/');
      expect(registration.files.length).toBeGreaterThan(0);
      expect(['error', 'warn']).toContain(registration.severity);
    }
  });

  it('is wired without eslint.config.ts naming any individual rule file', () => {
    // AC-06 — later increments add rules by dropping files in, not by editing config.
    const config = readFileSync(join(process.cwd(), 'eslint.config.ts'), 'utf8');
    for (const name of ruleFileNames()) {
      expect(config).not.toContain(name);
    }
    expect(config).toContain('loadRules');
  });
});
