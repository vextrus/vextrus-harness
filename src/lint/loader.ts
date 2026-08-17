/**
 * Auto-discovery for the repo's own lint rules (B-03: a new rule is a new file,
 * never an edit to a shared config). Every module in `src/lint/rules/*.ts`
 * exports `{ rule, files, severity }`; this turns them into registrations the
 * flat config mounts under the `vextrus` plugin namespace.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Rule } from 'eslint';

export type RuleRegistration = {
  name: string;
  rule: Rule.RuleModule;
  files: string[];
  severity: 'error' | 'warn';
};

/** The plugin namespace every discovered rule is mounted under. */
export const PLUGIN_NAMESPACE = 'vextrus';

const rulesDir = fileURLToPath(new URL('./rules', import.meta.url));

type RuleModuleExports = Pick<RuleRegistration, 'rule' | 'files' | 'severity'>;

export async function loadRules(): Promise<RuleRegistration[]> {
  const entries = readdirSync(rulesDir)
    .filter((entry) => entry.endsWith('.ts'))
    .sort();

  const registrations: RuleRegistration[] = [];
  for (const entry of entries) {
    const loaded = (await import(join(rulesDir, entry))) as RuleModuleExports;
    const name = entry.slice(0, -'.ts'.length);
    if (typeof loaded.rule?.create !== 'function') {
      throw new Error(`lint rule ${name} does not export a rule`);
    }
    if (!Array.isArray(loaded.files) || loaded.files.length === 0) {
      throw new Error(`lint rule ${name} does not export the files it applies to`);
    }
    if (loaded.severity !== 'error' && loaded.severity !== 'warn') {
      throw new Error(`lint rule ${name} does not export a severity`);
    }
    registrations.push({ name, rule: loaded.rule, files: loaded.files, severity: loaded.severity });
  }
  return registrations;
}
