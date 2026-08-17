import type { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { loadRules } from './src/lint/loader'

/**
 * The config wires the parser and the discovered guardrails — nothing else.
 * It names no rule file: guardrails arrive by dropping a module into the
 * loader's directory (B-03: extension without editing shared files).
 */
/** Plugin namespace for every discovered guardrail. */
const NAMESPACE = 'vextrus'

const registrations = loadRules()

const plugin = {
  rules: Object.fromEntries(registrations.map((registration) => [registration.name, registration.rule])),
}

/** Q-08: a suppression directive must never be able to switch off the rule that reports it. */
const linterOptions = { noInlineConfig: true } as const

const config: Linter.Config[] = [
  {
    ignores: ['node_modules/**', '.next/**', '.next-verify/**', '.storage/**', 'coverage/**', 'next-env.d.ts'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    linterOptions,
    languageOptions: {
      parser: tseslint.parser as Linter.Parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  ...registrations.map((registration) => ({
    files: registration.files,
    linterOptions,
    plugins: { [NAMESPACE]: plugin },
    rules: { [`${NAMESPACE}/${registration.name}`]: registration.severity },
  })),
]

export default config
