import { defineConfig } from 'vitest/config';

/**
 * One runner for every lane (B-03). `include` is deliberately broad so a test
 * dropped anywhere in the tree runs without editing this file; the verify stage
 * picks the lanes it wants by path, since `tests/e2e` boots a dev server and
 * would both blow the Q-01 budget and contend for port 3210.
 */
export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-verify/**',
      '**/dist/**',
      '**/.git/**',
    ],
    environment: 'node',
    // Contract and journey lanes drive real processes and real ports; running
    // files in parallel would make them contend for 3210/3211.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
