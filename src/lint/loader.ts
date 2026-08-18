/**
 * Auto-discovery of the repo's custom lint rules.
 *
 * A new guardrail is a new file in `src/lint/rules/` — never an edit to
 * `eslint.config.ts` (B-03: later increments extend without touching shared
 * files). Each rule module exports the registration triple `{ rule, files,
 * severity }`; the file name is the rule name, so the id reads
 * `vextrus/<file-name>`.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import type { Rule } from 'eslint';
import { createJiti } from 'jiti';

export type RuleRegistration = {
  name: string;
  rule: Rule.RuleModule;
  files: string[];
  severity: 'error' | 'warn';
};

/** The plugin namespace every discovered rule is registered under. */
export const PLUGIN_NAMESPACE = 'vextrus';

const RULES_DIR = path.join(import.meta.dirname, 'rules');

/**
 * Rule modules are TypeScript and must load synchronously from two very
 * different hosts: vitest (already transpiling) and ESLint's config loader.
 * jiti is the one loader both can use.
 */
const jiti = createJiti(import.meta.url);

type RuleModule = {
  rule?: Rule.RuleModule;
  files?: string[];
  severity?: 'error' | 'warn';
};

function ruleFiles(): string[] {
  return readdirSync(RULES_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts'))
    .sort();
}

export function loadRules(): RuleRegistration[] {
  return ruleFiles().map((file) => {
    const name = file.slice(0, -'.ts'.length);
    const loaded = jiti(path.join(RULES_DIR, file)) as RuleModule;
    const { rule, files, severity } = loaded;
    if (rule === undefined || typeof rule.create !== 'function') {
      throw new Error(`lint rule ${name} does not export a \`rule\` with a create()`);
    }
    if (files === undefined || files.length === 0) {
      throw new Error(`lint rule ${name} does not export a non-empty \`files\` list`);
    }
    if (severity !== 'error' && severity !== 'warn') {
      throw new Error(`lint rule ${name} does not export a \`severity\` of error or warn`);
    }
    return { name, rule, files, severity };
  });
}
