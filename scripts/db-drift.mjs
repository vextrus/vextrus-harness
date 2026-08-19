#!/usr/bin/env node
/**
 * One migration lane, and a check that it is the only one (stack-drizzle).
 *
 * Drift is a column added to `db/schema/*.ts` with no migration behind it: the
 * TypeScript says one thing, the SQL another, and the database is whichever the
 * last deploy happened to apply. So this asks drizzle-kit the only question that
 * settles it — "given the migrations already on disk, is there anything left to
 * generate?" — and treats any answer but "nothing" as divergence.
 *
 * It generates into a scratch directory under $TMPDIR, never into
 * `db/migrations/`. A check that edits the tree it is checking is not a check:
 * it turns a red report into a green one by writing the very migration whose
 * absence was the finding. Only `meta/` (drizzle-kit's snapshot and journal) is
 * copied into the scratch, because that is what the diff is computed against.
 *
 * The verdict is a single line, in the `ok`/`FAIL <fact> — detail` shape the rest
 * of the repo reports in, and a divergent run prints the token DRIFT.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { repoRoot } from './lib/stage.mjs';
import { report, summarise } from './lib/report.mjs';

const MIGRATIONS = join(repoRoot, 'db', 'migrations');
const SCHEMA = './db/schema/index.ts';

/** drizzle-kit's own words for "the schema and the migrations already agree". */
const NOTHING_TO_MIGRATE = /no schema changes/i;

const scratch = mkdtempSync(join(tmpdir(), 'vextrus-drift-'));

/** Every `*.sql` sitting directly in a directory — what a generate would add. */
const generated = (directory) =>
  readdirSync(directory)
    .filter((entry) => entry.endsWith('.sql'))
    .sort();

let results = [];
try {
  const meta = join(MIGRATIONS, 'meta');
  if (!existsSync(meta)) {
    results = [report('db-drift', false, `DRIFT — ${meta} is missing, so no migration state can be compared`)];
  } else {
    cpSync(meta, join(scratch, 'meta'), { recursive: true });

    const drizzleKit = join(repoRoot, 'node_modules', '.bin', 'drizzle-kit');
    // drizzle-kit resolves `out` as `./<out>`, so the scratch has to reach $TMPDIR
    // as a path relative to the repo root rather than as an absolute one.
    const out = relative(repoRoot, scratch);
    const run = spawnSync(
      drizzleKit,
      ['generate', '--dialect', 'postgresql', '--schema', SCHEMA, '--out', out, '--name', 'drift_check'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const pending = generated(scratch);

    if (pending.length > 0) {
      results = [
        report(
          'db-drift',
          false,
          `DRIFT — db/schema/ has ${pending.length} change(s) with no migration: drizzle-kit would generate ${pending.join(', ')}`,
        ),
      ];
    } else if (!run.error && run.status === 0 && NOTHING_TO_MIGRATE.test(output)) {
      // The verdict is positive on both sides. drizzle-kit exits 0 even when it
      // fails to read the migration folder, so "it wrote no SQL" on its own is
      // not evidence of agreement — it is equally the shape of a check that
      // never ran, which is the cache that lies (B-03).
      results = [report('db-drift', true, 'db/schema matches db/migrations — nothing left to generate')];
    } else {
      const detail = output.trim().split('\n').slice(-3).join(' ') || 'no output';
      results = [report('db-drift', false, `DRIFT — drizzle-kit could not compare the schema: ${detail}`)];
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.exitCode = summarise(results);
