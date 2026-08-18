/**
 * Acceptance journeys (tests/e2e/*.e2e.ts). Kept out of `pnpm test` on purpose:
 * these drive `pnpm verify` and `pnpm dev`, so they must never run inside the
 * verify run's own vitest stage.
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
