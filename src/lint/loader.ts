/**
 * Auto-discovery for the repository's own lint rules.
 *
 * A later increment adds a guardrail by dropping a file into `src/lint/rules/`
 * that exports `{ rule, files, severity }`; nothing shared is edited (B-03).
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Rule } from 'eslint';
import { createJiti } from 'jiti';

export type RuleRegistration = {
  name: string;
  rule: Rule.RuleModule;
  files: string[];
  severity: 'error' | 'warn';
};

/** Plugin namespace every discovered rule is registered under. */
export const PLUGIN_NAMESPACE = 'vextrus';

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesDir = path.join(here, 'rules');

/** ESLint's config loader and vitest must share one TypeScript loading path. */
const jiti = createJiti(import.meta.url, { interopDefault: true });

type RuleModuleShape = {
  rule?: Rule.RuleModule;
  files?: string[];
  severity?: 'error' | 'warn';
};

function isRuleSource(fileName: string): boolean {
  return fileName.endsWith('.ts') && !fileName.endsWith('.d.ts');
}

export function loadRules(): RuleRegistration[] {
  const registrations: RuleRegistration[] = [];

  for (const fileName of readdirSync(rulesDir).sort()) {
    if (!isRuleSource(fileName)) continue;
    const name = fileName.replace(/\.ts$/, '');
    const loaded = jiti(path.join(rulesDir, fileName)) as RuleModuleShape;

    const rule = loaded.rule;
    const files = loaded.files;
    const severity = loaded.severity;
    if (rule === undefined || typeof rule.create !== 'function') {
      throw new Error(`lint rule "${name}" does not export a rule`);
    }
    if (files === undefined || files.length === 0) {
      throw new Error(`lint rule "${name}" does not export the files it applies to`);
    }
    if (severity !== 'error' && severity !== 'warn') {
      throw new Error(`lint rule "${name}" does not export a severity`);
    }

    registrations.push({ name, rule, files, severity });
  }

  return registrations;
}
