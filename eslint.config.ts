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
    /**
     * Typed linting, on from the start. The guardrails that land in later
     * increments — boundary rules, the NEVERs — need type information, and
     * `projectService` is what puts it behind `context.sourceCode.parserServices`.
     * Turning it on later would mean editing this shared file, which is the one
     * thing the loader design exists to avoid.
     *
     * Scoped to the TypeScript sources tsconfig.json actually owns: the drop-in
     * runners are `.mjs` and belong to no project, so the service must not be
     * asked about them.
     */
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
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
