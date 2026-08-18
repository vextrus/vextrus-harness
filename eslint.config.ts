import tseslint from 'typescript-eslint';

import { loadRules } from './src/lint/loader';

/** The namespace this repo's own guardrails are registered under. */
const NAMESPACE = 'vextrus';

const registrations = loadRules();

const plugin = {
  rules: Object.fromEntries(registrations.map((r) => [r.name, r.rule])),
};

export default tseslint.config(
  {
    ignores: ['node_modules/**', '.next/**', '.next-verify/**', 'next-env.d.ts'],
  },
  ...tseslint.configs.recommended,
  {
    // Q-08: a suppression comment must not be able to switch off the rule that forbids it.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
  },
  // Discovery, not enumeration: a new guardrail file needs no edit here.
  ...registrations.map((registration) => ({
    files: registration.files,
    plugins: { [NAMESPACE]: plugin },
    rules: { [`${NAMESPACE}/${registration.name}`]: registration.severity },
  })),
);
