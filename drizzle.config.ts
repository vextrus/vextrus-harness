import { defineConfig } from 'drizzle-kit';

/**
 * One migration lane (stack-drizzle): schema in TS, SQL on disk, generated from
 * `db/schema/index.ts` and nowhere else.
 *
 * `out` is the committed lane. `pnpm db:drift` never generates into it — it
 * copies `meta/` into a scratch directory under $TMPDIR and generates there, so
 * a drift check reports on the tree without editing it (AC-07).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
});
