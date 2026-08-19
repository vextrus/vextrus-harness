/**
 * Q-08 / B-03: a suite modifier must not be able to shrink `pnpm test` while
 * `pnpm verify` stays green.
 *
 * `vextrus/no-forbidden-escapes` judges an imported callee by the module it came
 * from, so a one-line re-export barrel launders it:
 *
 *     // src/test-support.ts
 *     export { describe, it, expect } from 'vitest';
 *
 *     // src/thing.test.ts
 *     import { describe, it } from './test-support';
 *     it.only('the only test that runs', () => { ... });
 *
 * The barrel is the ordinary way a repo grows shared test helpers, and vitest
 * honours the modifier through it — the sibling tests are silently skipped and
 * the run is green. The guardrail must see it: inside a test file, a modifier
 * taken off the runner's own opener is suite surgery no matter which path the
 * opener was imported by.
 *
 * Routing (arbitration, m0-02-db-lane): the five invalid cases below are a
 * correct B-05 encoding of SEAM-TENANT's lint ban and survive intact — but the
 * surface they judge, `src/lint/rules/no-forbidden-escapes.ts`, belongs to
 * m0-01b's rule surface, not to the database lane. They were byte-identical red
 * before the db lane's first file existed, so they could not discriminate that
 * increment's work. They live here, under a `.pending.ts` suffix that
 * `vitest.config.ts`'s include (test and spec suffixes only) does not match, so
 * they gate no other increment while staying type-checked and linted. When
 * m0-01b picks them up: rename to `q08-suite-modifier-smuggling.spec.ts` under
 * `tests/acceptance/`, drop one `../` from the rule import above, and make them
 * pass. They may not be deleted or diluted.
 *
 * The forbidden tokens are assembled from fragments so this file survives the
 * repo's own `eslint .` and vitest never sees a real modifier (risk note 1).
 */
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

import { rule } from '../../../src/lint/rules/no-forbidden-escapes';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ONLY = `.${'only'}`;
const SKIP = `.${'skip'}`;
const TODO = `.${'todo'}`;

const ruleTester = new RuleTester();

// The rule module is written against ESLint's own `Rule.RuleModule`; the tester
// speaks typescript-eslint's flavour of the same object.
const underTest = rule as unknown as Parameters<typeof ruleTester.run>[1];

/** A path the rule already recognises as a test file. */
const TEST_FILE = 'thing.test.ts';

describe('Q-08 — a suite modifier cannot be laundered through a re-export barrel', () => {
  ruleTester.run('no-forbidden-escapes', underTest, {
    valid: [
      // The discrimination stays the file, not the name: a domain module that
      // exports something called `test` is ordinary code outside a test file.
      {
        code: `import { test } from './domain';\nexport const parked = test${SKIP};`,
        filename: 'src/domain-caller.ts',
      },
    ],
    invalid: [
      {
        // The barrel case: `it` re-exported from a local helpers module.
        code: `import { it } from './test-support';\nit${ONLY}('runs alone', () => {});`,
        filename: TEST_FILE,
        errors: [{ messageId: 'testModifier' }],
      },
      {
        code: `import { describe } from '../support/helpers';\ndescribe${SKIP}('parked', () => {});`,
        filename: TEST_FILE,
        errors: [{ messageId: 'testModifier' }],
      },
      {
        code: `import { test as case_ } from './test-support';\ncase_${TODO}('unwritten');`,
        filename: TEST_FILE,
        errors: [{ messageId: 'testModifier' }],
      },
      {
        // Destructuring the modifier off a laundered opener is the same surgery.
        code: `import { it } from './test-support';\nconst { only } = it;\nonly('runs alone', () => {});`,
        filename: TEST_FILE,
        errors: [{ messageId: 'testModifier' }],
      },
      {
        // A dynamic import hides the source from the binding just as well.
        code: `const { it } = await import('vitest');\nit${SKIP}('parked', () => {});`,
        filename: TEST_FILE,
        errors: [{ messageId: 'testModifier' }],
      },
    ],
  });
});
