import tseslint from 'typescript-eslint';
import { loadRules } from './src/lint/loader.ts';

/**
 * The V-VERIFY eslint stage. Guardrails are discovered, never listed: every
 * module found by `loadRules()` is registered under the `vextrus` plugin
 * namespace with the globs and severity it declares for itself.
 */
const discovered = loadRules();

const plugin = {
  rules: Object.fromEntries(discovered.map((entry) => [entry.name, entry.rule])),
};

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-verify/**',
      'coverage/**',
      'next-env.d.ts',
      'var/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2023 as const,
      sourceType: 'module' as const,
    },
    // Q-08: a suppression comment must never be able to switch off the
    // guardrail that forbids suppression comments.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' as const },
    // In this repo the guardrail names itself in the transcript rather than
    // leaving a forbidden directive to ESLint's anonymous inline-config warning.
    settings: { vextrus: { reportLinterDirectives: true } },
    plugins: { vextrus: plugin },
  },
  ...discovered.map((entry) => ({
    files: entry.files,
    rules: { [`vextrus/${entry.name}`]: entry.severity },
  })),
];
