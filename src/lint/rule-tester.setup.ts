/**
 * Fixture-lane setup for ESLint's RuleTester (loaded by `vitest.config.ts`).
 *
 * A guardrail fixture for Q-08 necessarily contains a real lint-suppression
 * comment. RuleTester's own default is `reportUnusedDisableDirectives: 'warn'`,
 * so ESLint's core reports such a fixture as an unused directive AND offers a
 * fix that deletes it — the fixture would be judged on core's autofix instead
 * of on the rule under test. Turning inline config off for the whole lane is
 * the documented remedy, and it is the only honest one here: a suppression
 * comment must never be able to switch off the rule that forbids it.
 *
 * This mirrors `linterOptions` in `eslint.config.ts`, so a fixture is linted
 * under the same terms as the repo.
 */
import { RuleTester } from '@typescript-eslint/rule-tester';

RuleTester.setDefaultConfig({
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
});
