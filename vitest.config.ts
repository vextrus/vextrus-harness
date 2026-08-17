import { defineConfig } from 'vitest/config';

/**
 * The V-VERIFY vitest stage runs the unit suites under `src/`. The acceptance
 * and journey suites shell out to `pnpm verify` and `pnpm dev`, so they are a
 * separate lane selected by `VITEST_LANE` (see scripts/e2e.mjs) and are never
 * pulled into the verify run.
 */
const lane = process.env['VITEST_LANE'] ?? 'unit';

const LANES: Record<string, string[]> = {
  unit: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  e2e: ['tests/e2e/**/*.test.ts'],
  acceptance: ['tests/**/*.test.ts'],
};

export default defineConfig({
  test: {
    include: LANES[lane] ?? LANES['unit'] ?? [],
    // See the file: it puts RuleTester on the same inline-config terms as the
    // repo's own eslint.config.ts.
    setupFiles: ['src/lint/rule-tester.setup.ts'],
    environment: 'node',
    // B-03 — no cache that can lie.
    cache: false,
    // ESLint's RuleTester registers its fixture cases through the ambient
    // describe/it, so the guardrail fixtures show up as real, countable tests.
    globals: true,
  },
});
