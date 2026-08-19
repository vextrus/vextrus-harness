/**
 * V-E2E's runner configuration. The lane itself (build, database, servers) is
 * scripts/e2e.mjs; this file is only what Playwright needs to know.
 *
 * Two decisions worth the ink:
 *
 * 1. `testMatch` is `*.journey.ts` and nothing else. `tests/e2e/` already holds
 *    the vitest acceptance journeys of earlier increments as `*.e2e.ts`, and a
 *    runner that collected those would run vitest files under Playwright and
 *    report them as broken. The suffix is the contract (AC-10).
 * 2. Screenshots are deterministic by configuration, not by hope: one browser,
 *    a fixed viewport, `deviceScaleFactor: 1`, reduced motion and disabled
 *    animations. Everything left over is masked per journey
 *    (tests/e2e/harness/masks.ts). `maxDiffPixelRatio: 0.002` is the Bible's.
 */
import { defineConfig, devices } from '@playwright/test';

/** The lane starts `next start` here; a direct `playwright test` can be pointed elsewhere. */
const baseURL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:3211';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.journey.ts',
  /**
   * The one `*.journey.ts` that is harness rather than journey: it exists to put
   * the `test.describe` call in a file Playwright is willing to *report* (see
   * tests/e2e/harness/describe.journey.ts), and a test file may not be imported
   * by another test file — so it carries the suffix and is not collected.
   */
  testIgnore: '**/harness/describe.journey.ts',

  /**
   * Baselines are committed under tests/e2e/baselines/<journeyId>/<checkpoint>.png.
   * `checkpoint()` passes `[journeyId, '<name>.png']`, so `{arg}` is the pair and
   * no `{platform}` appears anywhere in the path: Linux baselines are the only
   * ones this repo has, and a darwin-suffixed PNG would be a second truth.
   */
  snapshotPathTemplate: 'tests/e2e/baselines/{arg}{ext}',

  /** Traces, videos and the checkpoint attachments of a run. Gitignored. */
  outputDir: 'var/e2e/artifacts',

  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { outputFolder: 'var/e2e/report', open: 'never' }]],

  use: {
    baseURL,
    // "traces" in V-E2E is unqualified: always on, not on-retry, because the run
    // worth debugging is usually the one that was not retried.
    trace: 'on',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    // Not a top-level test option; `reducedMotion` is a context option, and a
    // baseline taken with animations still running is a baseline that flickers.
    contextOptions: { reducedMotion: 'reduce' },
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } }],
});
