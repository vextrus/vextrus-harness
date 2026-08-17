/**
 * AC-06 — Q-08's six escape hatches are lint errors, each proven by a fixture.
 *
 * AC-13: this file must itself pass `eslint .` and must not perturb vitest
 * collection, so every forbidden token below is CONSTRUCTED at runtime and
 * never written literally in this source. Fixtures live as string constants
 * only — never as real files on disk.
 */
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

const ruleTester = new RuleTester({
  // Inline directives must not be able to suppress this rule — otherwise the
  // ESLint disable-directive fixture would silence its own report (Q-08).
  linterOptions: { noInlineConfig: true },
})

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

ruleTester.run('vextrus/no-forbidden-escapes', rule, {
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
    { code: `export const value: ${ANY} = 1`, errors: 1 },
    { code: `export function f(x: ${ANY}): number { return Number(x) }`, errors: 1 },
    // AC-06 token 2: the TS ignore pragma.
    { code: `// ${TS_IGNORE}\nexport const g = 1`, errors: 1 },
    // AC-06 token 3: the TS expect-error pragma.
    { code: `// ${TS_EXPECT_ERROR}\nexport const h = 1`, errors: 1 },
    // AC-06 token 4: the ESLint disable directive, all comment variants (AC-12).
    { code: `/* ${ESLINT_DISABLE} */\nexport const i = 1`, errors: 1 },
    { code: `// ${ESLINT_DISABLE_NEXT_LINE}\nexport const j = 1`, errors: 1 },
    { code: `/* ${ESLINT_DISABLE_NEXT_LINE} no-console */\nexport const k = 1`, errors: 1 },
    // AC-06 token 5: .skip as a test-call modifier.
    { code: `${DECLARE_DESCRIBE}\ndescribe${SKIP}("s", () => {})`, errors: 1 },
    { code: `${DECLARE_IT}\nit${SKIP}("s", () => {})`, errors: 1 },
    // AC-06 token 6: .only as a test-call modifier.
    { code: `${DECLARE_IT}\nit${ONLY}("o", () => {})`, errors: 1 },
    { code: `${DECLARE_TEST}\ntest${ONLY}("o", () => {})`, errors: 1 },
  ],
})
