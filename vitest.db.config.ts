/**
 * V-DB: the live database lane (`pnpm test:db`).
 *
 * A separate config from `pnpm test` because these are not unit tests — they
 * open connections to the migrated database as three different roles and prove
 * what the database refuses. They are excluded from `vitest.config.ts` by living
 * under `db/__tests__/`, which its include globs do not reach.
 *
 * The reporter is verbose on purpose. The suite discovers its tables, so the
 * list of what it proved is a result, not a constant — and a lane whose coverage
 * is invisible is a lane nobody can check grew when a table did.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Q-01 / B-03: no cache that can lie.
    cache: false,
    include: ['db/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    fileParallelism: false,
    reporters: ['verbose'],
    // The V-DB budget is 30 s for the whole lane; no single fact may eat it.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
