/**
 * AC-04 / AC-05 — verify is fail-fast and its exit code is the contract.
 *
 * Both cases inject a scratch file under src/, run the real `pnpm verify`, and
 * assert both the failing stage AND the absence of every later stage. The two
 * injections must not overlap, so they live in one file (vitest runs tests
 * within a file sequentially) and each cleans up in a finally block.
 */
import { describe, expect, it } from 'vitest'
import { isNestedRun, mentionsStage, pnpm, withScratchFile } from './support/proc'

// Constructed so this test file itself carries no forbidden token (AC-13).
const AT = '@'
const TS_IGNORE_TOKEN = `${AT}ts-ignore`

const TYPE_ERROR_FILE = 'src/__acceptance_scratch__/type-error.ts'
const FORBIDDEN_TOKEN_FILE = 'src/__acceptance_scratch__/forbidden-token.ts'

const TYPE_ERROR_SOURCE = [
  '// Deliberate type error injected by acceptance test AC-04.',
  "export const wrong: number = 'not a number'",
  '',
].join('\n')

// Type-clean on purpose: it must survive tsc and be caught by eslint (AC-05).
const FORBIDDEN_TOKEN_SOURCE = [
  '// Deliberate escape-hatch injected by acceptance test AC-05.',
  `// ${TS_IGNORE_TOKEN}`,
  'export const injected = 1',
  '',
].join('\n')

if (!isNestedRun) {
  describe('AC-04 a type error stops verify at tsc', () => {
    it('exits non-zero at tsc; eslint, vitest and build never run', () => {
      const result = withScratchFile(TYPE_ERROR_FILE, TYPE_ERROR_SOURCE, () => pnpm(['verify']))

      // AC-04 / V-VERIFY: exit code is the whole contract.
      expect(result.status, result.output).not.toBe(0)
      // AC-04: it failed at the tsc stage, which therefore ran.
      expect(mentionsStage(result.output, 'tsc'), result.output).toBe(true)
      // AC-04: fail-fast, verified by stage output absence.
      for (const stage of ['eslint', 'vitest', 'build']) {
        expect(
          mentionsStage(result.output, stage),
          `${stage} ran after tsc failed — verify is not fail-fast\n${result.output}`,
        ).toBe(false)
      }
    })
  })

  describe('AC-05 a forbidden escape stops verify at eslint', () => {
    it('exits non-zero at eslint naming vextrus/no-forbidden-escapes; build never runs', () => {
      const result = withScratchFile(FORBIDDEN_TOKEN_FILE, FORBIDDEN_TOKEN_SOURCE, () => pnpm(['verify']))

      // AC-05 / Q-08: the escape hatch is a lint error.
      expect(result.status, result.output).not.toBe(0)
      expect(mentionsStage(result.output, 'eslint'), result.output).toBe(true)
      // AC-05: the rule id appears in the output.
      expect(result.output, result.output).toContain('vextrus/no-forbidden-escapes')
      // AC-05 + fail-fast: nothing after eslint runs.
      expect(
        mentionsStage(result.output, 'build'),
        `build ran after eslint failed\n${result.output}`,
      ).toBe(false)
    })
  })
}
