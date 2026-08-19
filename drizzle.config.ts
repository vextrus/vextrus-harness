/**
 * stack-drizzle: schema in TS, SQL migrations, one migration lane.
 *
 * `out` is the lane's own directory, and authoring a migration is the only thing
 * that writes there. `pnpm db:drift` does not use this config at all — it points
 * drizzle-kit at a scratch directory under $TMPDIR, because a check that can
 * write into the tree it is checking is not a check (AC-07).
 *
 * Authoring the next migration:
 *
 *   pnpm exec drizzle-kit generate --name <what-it-does>
 *
 * then move the generated `NNNN_<name>.sql` into a directory of the same name —
 * `db/migrations/NNNN_<name>/0000_schema.sql` — and put any SQL drizzle-kit
 * cannot express (grants, FORCE RLS, `select public.seam_secure(...)`) beside it
 * as `0010_seam.sql`. A migration is a directory because those two belong to one
 * atomic step; `scripts/db-migrate.mjs` applies a directory's files in filename
 * order inside one transaction. The regenerated `db/migrations/meta/` is
 * committed with it: that snapshot is what `pnpm db:drift` compares against.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
});
