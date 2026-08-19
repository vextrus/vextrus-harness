/**
 * One migration lane (stack-drizzle): schema in TS, SQL out.
 *
 * `out` is the committed lane; `pnpm db:drift` never points drizzle-kit at it —
 * it copies the snapshots into a scratch directory and generates there, so a
 * drift *report* can never become a tree edit.
 */
import { defineConfig } from 'drizzle-kit';

const bootstrap = (process.env['VDB_PG_URL'] ?? '').trim();
const database = (process.env['VDB_PG_DATABASE'] ?? '').trim();

const url = new URL(bootstrap === '' ? 'postgres://postgres:postgres@127.0.0.1:5544/postgres' : bootstrap);
url.username = 'vextrus_migrate';
url.password = 'vextrus_migrate';
url.pathname = `/${database === '' ? 'vextrus_dev' : database}`;

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: process.env['VDB_DRIZZLE_OUT'] ?? './db/migrations',
  dbCredentials: { url: url.toString() },
  verbose: false,
  strict: false,
});
