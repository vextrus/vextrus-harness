import { defineConfig } from 'vitest/config';

/**
 * Acceptance lane. Deliberately a *separate* config with a `*.accept.ts`
 * suffix so the default `pnpm test` (the V-VERIFY vitest stage) never picks
 * these up — an acceptance suite that shells out to `pnpm verify` from inside
 * `pnpm verify` would recurse forever, and would also blow the Q-01 60 s budget.
 *
 * Run with: pnpm exec vitest run --config vitest.acceptance.config.ts
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.accept.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
