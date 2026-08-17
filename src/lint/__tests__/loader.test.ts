import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadRules } from '../loader';

const repoRoot = process.cwd();
const rulesDir = join(repoRoot, 'src', 'lint', 'rules');

function ruleFileNames(): string[] {
  return readdirSync(rulesDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

describe('lint rule loader', () => {
  // AC-06: the loader discovers src/lint/rules/*.ts by convention.
  it('registers one entry per rule module on disk', async () => {
    const registered = (await loadRules()).map((r) => r.name).sort();
    expect(registered).toEqual(ruleFileNames());
    expect(registered).toContain('no-forbidden-escapes');
  });

  // AC-06: each module's { rule, files, severity } is carried through verbatim.
  it('carries each module rule, files and severity', async () => {
    const registrations = await loadRules();
    for (const registration of registrations) {
      const mod = await import(join(rulesDir, `${registration.name}.ts`));
      expect(registration.rule).toBe(mod.rule);
      expect(registration.files).toEqual(mod.files);
      expect(registration.severity).toBe(mod.severity);
      expect(['error', 'warn']).toContain(registration.severity);
    }
  });

  // AC-06: eslint.config.ts must not name any individual rule file — new rules
  // arrive as new files only. (B-03: later increments never edit shared files.)
  it('is wired into eslint.config.ts without naming any rule', () => {
    const config = readFileSync(join(repoRoot, 'eslint.config.ts'), 'utf8');
    expect(config).toContain('loadRules');
    for (const name of ruleFileNames()) {
      expect(config).not.toContain(name);
    }
  });
});
