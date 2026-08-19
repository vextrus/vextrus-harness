/**
 * The V-DB lane: live Postgres seam tests under `db/__tests__/`.
 *
 *   pnpm db:migrate && pnpm test:db
 *
 * Kept out of `pnpm test` — and therefore out of `pnpm verify` — on purpose.
 * These tests talk to a real database; a unit lane that silently needs Postgres
 * is a unit lane that goes red for reasons that have nothing to do with the tree.
 *
 * `verbose` is part of the contract, not a preference. The lane discovers its
 * tables from the catalog, so the only place a reader can see *which* tables
 * were proven is the list of test titles — a table that was never discovered and
 * a table that passed must not look the same from outside.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['db/__tests__/**/*.{test,spec}.ts'],
    cache: false,
    fileParallelism: false,
    reporters: ['verbose'],
    environment: 'node',
    // V-DB's budget is 30s for the whole lane; no single fact may eat it.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
