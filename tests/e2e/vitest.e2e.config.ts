/**
 * Config for the journey segments. These spawn `pnpm verify`, `pnpm checkup`
 * and `pnpm dev`, so they must NOT be part of the default vitest project that
 * `pnpm verify` itself runs (that would recurse and blow the Q-01 60 s budget).
 *
 * Run them with:
 *   pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.spec.ts'],
    // Each segment drives the whole repo as a child process; never overlap them.
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
    passWithNoTests: false,
  },
});
