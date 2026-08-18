/**
 * Auto-discovery for this repo's own lint rules.
 *
 * A new guardrail is a new file in `src/lint/rules/`: it exports the triple
 * `{ rule, files, severity }` and is picked up here, so `eslint.config.ts` never
 * names a rule and later increments never touch a shared file.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';

import type { Rule } from 'eslint';
import { createJiti } from 'jiti';

export interface RuleRegistration {
  /** The rule's file basename; the id under the plugin namespace. */
  name: string;
  rule: Rule.RuleModule;
  /** Flat-config globs the rule applies to. */
  files: string[];
  severity: 'error' | 'warn';
}

/** The plugin namespace the flat config registers these rules under. */
export const PLUGIN_NAMESPACE = 'vextrus';

const RULES_DIR = fileURLToPath(new URL('./rules/', import.meta.url));

const isRuleFile = (entry: string): boolean =>
  entry.endsWith('.ts') &&
  !entry.endsWith('.d.ts') &&
  !entry.endsWith('.spec.ts') &&
  !entry.endsWith('.test.ts');

function asRegistration(name: string, loaded: unknown): RuleRegistration {
  const module = loaded as Partial<Record<'rule' | 'files' | 'severity', unknown>>;
  const rule = module.rule as Rule.RuleModule | undefined;
  const files = module.files as string[] | undefined;
  const severity = module.severity as RuleRegistration['severity'] | undefined;

  if (rule === undefined || typeof rule.create !== 'function') {
    throw new Error(`lint rule "${name}" must export a rule with a create() function`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`lint rule "${name}" must export a non-empty files glob array`);
  }
  if (severity !== 'error' && severity !== 'warn') {
    throw new Error(`lint rule "${name}" must export severity 'error' or 'warn'`);
  }
  return { name, rule, files, severity };
}

/**
 * Reads `src/lint/rules/*.ts` from disk on every call — discovery is a directory
 * listing, never a hardcoded list.
 *
 * `directory` defaults to the real rules directory; tests point it at a scratch
 * dir so a probe rule file is never written into the tree `eslint .` scans.
 */
export function loadRules(directory: string = RULES_DIR): RuleRegistration[] {
  const base = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  const jiti = createJiti(base, { moduleCache: false });
  return readdirSync(base)
    .filter(isRuleFile)
    .sort()
    .map((entry) => asRegistration(entry.slice(0, -'.ts'.length), jiti(join(base, entry))));
}
