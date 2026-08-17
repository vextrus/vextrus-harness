import { defineConfig } from 'vitest/config';

/**
 * The V-VERIFY vitest stage. Only unit suites under `src/` — the acceptance
 * lane lives in `vitest.acceptance.config.ts` and must never be pulled in here
 * (it shells out to `pnpm verify`).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // ESLint's RuleTester registers its fixture cases through the ambient
    // describe/it, so the guardrail fixtures show up as real, countable tests.
    globals: true,
  },
  cacheDir: 'node_modules/.vitest-verify',
});
