import tseslint from 'typescript-eslint';

import { loadRules } from './src/lint/loader';

/**
 * Flat config that names no rule file. Guardrails come from the loader, which
 * discovers them by directory scan, so a later increment ships a rule without
 * editing this file (B-03).
 */
const discovered = loadRules().map((registration) => ({
  files: registration.files,
  plugins: { vextrus: { rules: { [registration.name]: registration.rule } } },
  rules: { [`vextrus/${registration.name}`]: registration.severity },
}));

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-verify/**',
      'next-env.d.ts',
      '.storage/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Q-08: an inline directive must not be able to switch off the rule that
    // bans inline directives. Nothing in this repo may disable a check locally.
    linterOptions: { noInlineConfig: true },
  },
  ...discovered,
);
