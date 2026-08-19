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
  /**
   * The journeys, and only the journeys (AC-10). `tests/e2e/` as a whole also
   * holds the vitest acceptance files and the harness itself; pointing the
   * runner at the narrower directory is what keeps a file that is not a journey
   * from ever being collected as one. The harness self-test J-SELF is a journey
   * like the rest and lives here with them — what makes it the self-test is its
   * subject, not its directory.
   */
  testDir: 'tests/e2e/journeys',
  testMatch: '**/*.journey.ts',

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
  /**
   * A line per test on the console, and the same run as JSON beside the
   * artifacts — not the HTML report. The HTML reporter unpacks a bundled trace
   * viewer (some thousands of lines of minified JavaScript) into the tree on
   * every run, and `eslint .` would then lint it: a run's own scratch must not
   * be able to fail the repo's guardrails. The trace files themselves are still
   * written per test, and `pnpm exec playwright show-trace <trace.zip>` opens
   * one without leaving a viewer behind.
   */
  reporter: [['list'], ['json', { outputFile: 'var/e2e/report.json' }]],

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
