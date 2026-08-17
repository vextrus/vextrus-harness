import { Linter } from 'eslint'
import { RuleTester } from '@typescript-eslint/rule-tester'
import { loadRules } from './src/lint/loader'

/**
 * Fixture files address a guardrail by its real id — `vextrus/<rule>` — which
 * is the id an engineer sees in `eslint .` output and the id the Bible names.
 * The typed RuleTester configures whatever name it is given under its own
 * `@rule-tester/` prefix, and ESLint resolves the plugin from everything
 * before the last slash. So the namespace has to exist as a real plugin
 * inside the tester too: it is registered here from the same directory scan
 * the ESLint config uses, which keeps it correct for every future rule
 * without naming any of them.
 *
 * `reportUnusedDisableDirectives` is turned off for the tester only. Fixtures
 * run with `noInlineConfig`, under which ESLint emits an extra advisory
 * message for every suppression comment; that advisory is not the rule's
 * report, and counting it would hide whether the rule itself fired. The
 * repository's own lint run keeps both settings at their strict defaults.
 */
const NAMESPACE = 'vextrus'

const rules: Record<string, unknown> = {}
for (const registration of loadRules()) {
  rules[registration.name] = registration.rule
}

RuleTester.setDefaultConfig({
  plugins: { [`@rule-tester/${NAMESPACE}`]: { rules } },
})

/**
 * Under `noInlineConfig` ESLint adds its own advisory message for every
 * suppression comment it found and ignored. The guardrail rule reports those
 * same comments as errors, so in a test the two are one finding counted twice
 * — and a fixture that says "this comment produces exactly one report" would
 * be measuring ESLint's advisory rather than the rule. The advisory is
 * therefore dropped inside the test process only; `pnpm lint` and `pnpm
 * verify` run ESLint untouched.
 */
const NO_INLINE_CONFIG_ADVISORY = /has no effect because you have 'noInlineConfig' setting/

type LintMessage = { ruleId: string | null; message: string }
type Verify = (this: Linter, ...args: unknown[]) => LintMessage[]

const verify = Linter.prototype.verify as unknown as Verify

const patched: Verify = function patchedVerify(this: Linter, ...args) {
  const messages = verify.apply(this, args)
  if (!Array.isArray(messages)) return messages
  return messages.filter(
    (message) => !(message.ruleId === null && NO_INLINE_CONFIG_ADVISORY.test(message.message)),
  )
}

Linter.prototype.verify = patched as unknown as Linter['verify']
