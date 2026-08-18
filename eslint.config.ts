/**
 * Flat config. It names no individual guardrail — the loader discovers them —
 * so adding a rule never edits this file (B-03: zero codegen, one lane).
 */
import tseslint from 'typescript-eslint';

import { PLUGIN_NAMESPACE, loadRules } from './src/lint/loader';

const registrations = loadRules();

const plugin = {
  meta: { name: PLUGIN_NAMESPACE },
  rules: Object.fromEntries(registrations.map((r) => [r.name, r.rule])),
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-verify/**',
      '.storage/**',
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Q-08: an inline comment must never be able to switch a guardrail off.
    linterOptions: { noInlineConfig: true },
  },
  ...registrations.map((registration) => ({
    files: registration.files,
    plugins: { [PLUGIN_NAMESPACE]: plugin },
    rules: {
      [`${PLUGIN_NAMESPACE}/${registration.name}`]: registration.severity,
    },
  })),
);
