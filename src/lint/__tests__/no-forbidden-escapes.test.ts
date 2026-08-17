/**
 * AC-06 — Q-08's six escape hatches are lint errors, each proven by a fixture.
 *
 * AC-13: this file must itself pass `eslint .` and must not perturb vitest
 * collection, so every forbidden token below is CONSTRUCTED at runtime and
 * never written literally in this source. Fixtures live as string constants
 * only — never as real files on disk.
 */
import { Linter, type Rule } from 'eslint'
import { RuleTester } from '@typescript-eslint/rule-tester'
import { afterAll, describe, it } from 'vitest'
import { files, rule, severity } from '../rules/no-forbidden-escapes'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

// ---------------------------------------------------------------------------
// Constructed tokens (AC-13): none of these appear literally in this file.
// ---------------------------------------------------------------------------
const AT = '@'
const ANY = `an${'y'}`
const TS_IGNORE = `${AT}ts-ignore`
const TS_EXPECT_ERROR = `${AT}ts-expect-error`
const ESLINT_DISABLE = `eslint${'-'}disable`
const ESLINT_DISABLE_NEXT_LINE = `${ESLINT_DISABLE}-next-line`
const SKIP = `.${'skip'}`
const ONLY = `.${'only'}`

/** Test-runner stubs so the fixtures type-check without importing vitest. */
const modifiers = '{ skip: (n: string, f: () => void) => void; only: (n: string, f: () => void) => void }'
const DECLARE_IT = `declare const it: ${modifiers}`
const DECLARE_TEST = `declare const test: ${modifiers}`
const DECLARE_DESCRIBE = `declare const describe: ${modifiers}`

/**
 * `reportUnusedDisableDirectives` is off for the fixtures only. A scoped
 * disable directive in a fixture suppresses nothing (the rule reports on the
 * directive's own line, which a `-next-line` or rule-scoped directive does not
 * cover), so ESLint would add its own "unused directive" advisory on top of
 * the rule's report — an artifact of the fixture, not a second finding. The
 * repository's own `eslint .` keeps the setting at its strict default.
 */
const ruleTester = new RuleTester({ linterOptions: { reportUnusedDisableDirectives: 'off' } })

describe('AC-06 rule module shape', () => {
  it('exports the RuleRegistration fields the loader expects', () => {
    // Interfaces: named exports `rule`, `files`, `severity`.
    if (typeof rule.create !== 'function') throw new Error('rule.create must be a function')
    if (severity !== 'error') throw new Error(`severity must be 'error', got ${severity}`)
    const expected = ['**/*.ts', '**/*.tsx']
    if (JSON.stringify(files) !== JSON.stringify(expected)) {
      throw new Error(`files must be ${JSON.stringify(expected)}, got ${JSON.stringify(files)}`)
    }
  })
})

/**
 * The rule is registered under its bare name: the RuleTester supplies its own
 * plugin namespace, and it reads everything before the last slash of the name
 * it is given as a plugin to resolve — so a `vextrus/` prefix here would send
 * it looking for a plugin that does not exist inside the tester. The Bible's
 * rule id `vextrus/no-forbidden-escapes` gets its namespace from
 * eslint.config.ts, and AC-05 proves that id appears in real `eslint .` output.
 */
ruleTester.run('no-forbidden-escapes', rule, {
  valid: [
    // AC-12: substrings inside identifiers and strings must not over-fire.
    { code: 'const company = "anywhere"' },
    { code: 'const props = { skipLink: true }; export const a = props.skipLink' },
    { code: 'const data = { label: ".only" }; export const b = data.label' },
    { code: 'export const c = [1, 2, 3].some((n) => n > 1)' },
    { code: 'export const d = "we can lint-disable nothing here"' },
    // A well-typed test file with no modifiers is fine.
    { code: 'declare const it: (n: string, f: () => void) => void; it("works", () => {})' },
  ],
  invalid: [
    // AC-06 token 1: `any` as a type annotation.
    { code: `export const value: ${ANY} = 1`, errors: [{ messageId: 'untyped' }] },
    { code: `export function f(x: ${ANY}): number { return Number(x) }`, errors: [{ messageId: 'untyped' }] },
    // AC-06 token 2: the TS ignore pragma.
    { code: `// ${TS_IGNORE}\nexport const g = 1`, errors: [{ messageId: 'tsSuppress' }] },
    // AC-06 token 3: the TS expect-error pragma.
    { code: `// ${TS_EXPECT_ERROR}\nexport const h = 1`, errors: [{ messageId: 'tsSuppress' }] },
    // AC-06 token 4: the scoped disable directives (AC-12). Each reports on the
    // directive's own line, which the directive itself does not cover, so these
    // fire under plain inline-config handling; the file-wide variant is below.
    {
      code: `// ${ESLINT_DISABLE_NEXT_LINE}\nexport const j = 1`,
      errors: [{ messageId: 'lintSuppress' }],
    },
    {
      code: `/* ${ESLINT_DISABLE_NEXT_LINE} no-console */\nexport const k = 1`,
      errors: [{ messageId: 'lintSuppress' }],
    },
    // AC-06 token 5: .skip as a test-call modifier.
    { code: `${DECLARE_DESCRIBE}\ndescribe${SKIP}("s", () => {})`, errors: [{ messageId: 'testModifier' }] },
    { code: `${DECLARE_IT}\nit${SKIP}("s", () => {})`, errors: [{ messageId: 'testModifier' }] },
    // AC-06 token 6: .only as a test-call modifier.
    { code: `${DECLARE_IT}\nit${ONLY}("o", () => {})`, errors: [{ messageId: 'testModifier' }] },
    { code: `${DECLARE_TEST}\ntest${ONLY}("o", () => {})`, errors: [{ messageId: 'testModifier' }] },
  ],
})

/**
 * AC-06 token 4, bare form. A file-wide disable directive is the one variant
 * that would switch this rule off before it could report the directive itself,
 * so it is checked with `noInlineConfig`, which makes ESLint ignore inline
 * configuration. ESLint then adds an advisory of its own for the directive it
 * ignored; both messages are asserted, so nothing about the linter's real
 * output is filtered or patched away (B-03).
 *
 * The stock `Linter` is used directly here rather than RuleTester, which
 * cannot express an expected message that carries no messageId.
 */
describe('AC-06 file-wide suppression directive', () => {
  it('reports the directive that would otherwise suppress the rule', () => {
    const messages = new Linter().verify(
      `/* ${ESLINT_DISABLE} */\nexport const i = 1`,
      [
        {
          files,
          languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
          linterOptions: { noInlineConfig: true },
          plugins: { vextrus: { rules: { 'no-forbidden-escapes': rule as unknown as Rule.RuleModule } } },
          rules: { 'vextrus/no-forbidden-escapes': 'error' },
        },
      ],
      'fixture.ts',
    )

    const reported = messages.filter((message) => message.messageId === 'lintSuppress')
    if (reported.length !== 1) {
      throw new Error(`expected exactly one lintSuppress report, got ${JSON.stringify(messages)}`)
    }
    const [report] = reported
    if (report?.severity !== 2) throw new Error(`expected an error, got severity ${String(report?.severity)}`)
    // The one other message is ESLint's advisory about the directive it ignored.
    const advisories = messages.filter((message) => /noInlineConfig/u.test(message.message))
    if (messages.length !== 2 || advisories.length !== 1) {
      throw new Error(`expected the report plus one advisory, got ${JSON.stringify(messages)}`)
    }
  })
})
