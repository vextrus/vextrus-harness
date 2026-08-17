/**
 * Declarations for `@typescript-eslint/rule-tester`, mapped in over the
 * shipped ones by tsconfig `paths`.
 *
 * The shipped declarations model `errors` as an array of expected errors only,
 * while the tester it forks — and the tester at runtime — also accepts a plain
 * count, which is what an "it fires exactly once" fixture wants to say. They
 * also describe the rule argument with a RuleModule type from a linter version
 * older than the one this repository pins, so a rule written against the
 * current linter is rejected. Nothing here changes what the fixtures assert:
 * the real package is what runs.
 */
declare module '@typescript-eslint/rule-tester' {
  export interface ValidTestCase {
    readonly code: string
    readonly name?: string
    readonly filename?: string
    readonly options?: readonly unknown[]
    readonly [option: string]: unknown
  }

  export interface ExpectedError {
    readonly messageId?: string
    readonly message?: string
    readonly line?: number
    readonly column?: number
    readonly [option: string]: unknown
  }

  export interface InvalidTestCase extends ValidTestCase {
    readonly errors: number | readonly ExpectedError[]
    readonly output?: string | null
  }

  export interface RunTests {
    readonly valid: readonly (ValidTestCase | string)[]
    readonly invalid: readonly InvalidTestCase[]
  }

  export class RuleTester {
    static afterAll: unknown
    static describe: unknown
    static it: unknown
    static itOnly: unknown
    static itSkip: unknown
    static setDefaultConfig(config: Record<string, unknown>): void
    static getDefaultConfig(): Record<string, unknown>
    static resetDefaultConfig(): void
    constructor(config?: Record<string, unknown>)
    run(name: string, rule: unknown, tests: RunTests): void
  }
}
