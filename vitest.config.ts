import { defineConfig } from 'vitest/config';

/**
 * Q-01: no cache that can lie — every run re-reads the sources. The journey
 * segments under tests/e2e spawn `pnpm verify` themselves and are excluded
 * here; run them with tests/e2e/vitest.e2e.config.ts.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/contract/**/*.spec.ts'],
    exclude: ['node_modules/**', '.next/**', '.next-verify/**', 'tests/e2e/**'],
    passWithNoTests: false,
  },
});
