/**
 * The V-DB lane: `pnpm test:db`, the live seam suite under `db/__tests__/`.
 *
 * Kept out of `pnpm test` — and therefore out of `pnpm verify`'s vitest stage —
 * on purpose: these tests talk to a real Postgres, and a verify run must judge
 * the tree on a machine with no database as well as on one with. What `pnpm
 * verify` does carry is the drift stage, which is a statement about the tree.
 *
 * The reporter is verbose because the suite discovers its own subjects: the
 * names of the tables it found are the evidence that nothing here is a
 * hard-coded list, so they belong in the transcript (AC-02).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['db/__tests__/**/*.test.ts'],
    // Q-01 / B-03: no cache that can lie, here least of all — the subject is a
    // live database, and every fact must be re-proved on every run.
    cache: false,
    fileParallelism: false,
    reporters: ['verbose'],
    // V-DB's whole-lane budget is 30s; a single fact that needs more than 20 is
    // a fact that has stopped being a probe.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    environment: 'node',
  },
});
