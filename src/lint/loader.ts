import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rule } from 'eslint';

export type RuleRegistration = {
  name: string;
  rule: Rule.RuleModule;
  files: string[];
  severity: 'error' | 'warn';
};

/**
 * Auto-discovery is the whole point: a later increment adds a guardrail by
 * dropping a file into this directory, never by editing `eslint.config.ts`
 * (B-03 — zero shared-file churn).
 */
const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'rules');

const requireModule = createRequire(import.meta.url);

function isSeverity(value: unknown): value is 'error' | 'warn' {
  return value === 'error' || value === 'warn';
}

function registrationOf(fileName: string): RuleRegistration {
  const name = fileName.replace(/\.ts$/, '');
  const loaded: unknown = requireModule(join(RULES_DIR, fileName));
  const module = loaded as Partial<RuleRegistration>;
  const { rule, files, severity } = module;

  if (rule === undefined || typeof rule.create !== 'function') {
    throw new Error(`lint rule "${name}" does not export a rule with a create()`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`lint rule "${name}" does not export a non-empty files glob list`);
  }
  if (!isSeverity(severity)) {
    throw new Error(`lint rule "${name}" does not export severity "error" or "warn"`);
  }
  return { name, rule, files, severity };
}

export function loadRules(): RuleRegistration[] {
  return readdirSync(RULES_DIR)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts'))
    .sort()
    .map(registrationOf);
}
