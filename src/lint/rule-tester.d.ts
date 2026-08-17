/**
 * ESLint's RuleTester has always accepted a plain count for an invalid case's
 * `errors`, and `@typescript-eslint/rule-tester` still implements that at
 * runtime (RuleTester.js asserts `typeof item.errors === 'number'`), but its
 * published types only describe the array form. The fixture suites state the
 * count, so the numeric form is declared here as an extra overload rather than
 * dropping the fixtures out of the tsc stage.
 */
import type { RuleModule } from '@typescript-eslint/utils/ts-eslint';

declare module '@typescript-eslint/rule-tester' {
  interface RuleTesterValidCase {
    readonly code: string;
    readonly name?: string;
    readonly filename?: string;
  }

  interface RuleTesterInvalidCase extends RuleTesterValidCase {
    /** How many reports the fixture must produce. */
    readonly errors: number;
    readonly output?: string | readonly string[] | null;
  }

  interface RuleTester {
    run(
      ruleName: string,
      rule: RuleModule<string, readonly unknown[]>,
      tests: {
        readonly valid: readonly (RuleTesterValidCase | string)[];
        readonly invalid: readonly RuleTesterInvalidCase[];
      },
    ): void;
  }
}
