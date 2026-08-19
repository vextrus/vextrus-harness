import { runStep } from '../lib/stage.mjs';

/**
 * V-DB's tree-side half, in `pnpm verify` where every guardrail that matters
 * belongs (B-05): schema in TS and SQL migrations are one lane, and a schema
 * change with no migration behind it fails the run rather than waiting to be
 * noticed on a deploy.
 *
 * It stays a statement about the tree — no database is touched here — so a verify
 * run judges the same way on a machine with Postgres and on one without.
 */
const drift = runStep({ path: new URL('../db-drift.mjs', import.meta.url).pathname, name: 'db-drift' });

if (drift.stdout !== '') process.stdout.write(drift.stdout);
if (drift.stderr !== '') process.stderr.write(drift.stderr);
process.exitCode = drift.status;
