/**
 * The one line of the harness that has to live in a `*.journey.ts` file.
 *
 * Playwright records a describe block's location from the stack of the call that
 * created it, and reports that file as the suite's file. If `journey()` called
 * `test.describe` from `harness/index.ts`, every report — `--list`, the JSON
 * reporter, the traceability the lane is built on — would name a file that is
 * not a journey, and the lane's own contract (AC-10: Playwright reports
 * `*.journey.ts` and nothing else) would be false about the harness itself.
 *
 * So the call lives here, in a file named for what it produces. It declares no
 * tests of its own; the suffix is about where the stack frame points, not about
 * what this file contains.
 */
import { test } from '@playwright/test';

/** `test.describe`, called from a `*.journey.ts` file. Nothing more. */
export function describeJourney(title: string, fn: () => void): void {
  test.describe(title, fn);
}
