/**
 * stack-drizzle: schema in TS, SQL migrations, one migration lane.
 *
 * `out` is the lane's own directory, and authoring a migration is the only thing
 * that writes there. `pnpm db:drift` does not use this config at all — it points
 * drizzle-kit at a scratch directory under $TMPDIR, because a check that can
 * write into the tree it is checking is not a check (AC-07).
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
});
