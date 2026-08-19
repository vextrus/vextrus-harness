/**
 * The held-out V-E2E acceptance. Every file here shells out to the product's own
 * entry points — `pnpm e2e`, `node scripts/seed.mjs`, the worker entry — which
 * build the app, recreate one scratch database and bind port 3211: two files
 * doing that at once would be proving something about a race. So, one at a time,
 * cold, with room for a production build in every test.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    cache: false,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    environment: 'node',
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
