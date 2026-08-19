/**
 * The V-DB lane. Its own config because it is the only suite that needs a live
 * Postgres: `pnpm test` (and therefore `pnpm verify`) must stay runnable on a
 * machine with no database, so these tests are not in that run's include set.
 *
 *   pnpm db:migrate && pnpm test:db
 *
 * Serial, and cold. The facts are statements about one database — two files
 * seeding and dropping tables in parallel would be proving something about a
 * race instead. The 30 s budget (AC-02) is met by seeding once in `beforeAll`,
 * not by running the suite wide.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    cache: false,
    include: ['db/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
