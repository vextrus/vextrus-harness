import { defineConfig } from 'vitest/config';

/**
 * Q-01 / B-03: no cache that can lie — every `pnpm test` run is cold.
 * Journey segments live in `tests/e2e/*.e2e.ts` and are deliberately excluded:
 * they shell out to `pnpm verify`, which would re-enter this run.
 */
export default defineConfig({
  test: {
    cache: false,
    fileParallelism: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.next-verify/**', '**/*.e2e.ts'],
    environment: 'node',
  },
});
