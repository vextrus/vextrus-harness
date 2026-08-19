/**
 * One migration lane (stack-drizzle): schema in TS, SQL on disk, and a single
 * `out` directory. `db:drift` points drizzle-kit at a scratch directory instead
 * — generating into the tree is how a drift check quietly becomes a migration
 * generator (AC-07).
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './db/migrations',
  strict: true,
  verbose: false,
});
