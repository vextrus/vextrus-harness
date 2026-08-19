#!/usr/bin/env node
/**
 * stack-drizzle's drift check: does `db/schema/` still say what `db/migrations/`
 * did?
 *
 * The check has to answer that without becoming the thing it checks. So it never
 * writes into the lane: the committed `db/migrations/meta/` is copied into a
 * scratch directory under $TMPDIR, drizzle-kit generates *there* against the
 * current schema, and the verdict is whatever it produced. A generated statement
 * is a statement the database has never seen — that is drift, by definition.
 *
 * Exit 0 clean; non-zero with a line containing DRIFT otherwise.
 *
 * The verdict is read from the scratch directory rather than from drizzle-kit's
 * exit code, which is 0 in cases that are not "no changes" — including a run that
 * could not read the migration folder at all. A green that only means "the tool
 * did not crash" is exactly the cache that lies (B-03), so a failed generate is
 * reported as drift too: an answer nobody could compute is not a clean tree.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { report, summarise } from './lib/report.mjs';

const FACT = 'db-drift';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaEntry = join(repoRoot, 'db', 'schema', 'index.ts');
const committedMeta = join(repoRoot, 'db', 'migrations', 'meta');

const scratch = mkdtempSync(join(tmpdir(), 'vextrus-drift-'));
/**
 * drizzle-kit resolves `out` against the process cwd whatever it is given — an
 * absolute path becomes `.//tmp/...`, it cannot find the snapshot, and it exits
 * *0* having generated nothing, which reads exactly like a clean tree. So the
 * run happens from inside the scratch directory with a relative `out`, and the
 * verdict below is positive on both sides rather than "nothing was written".
 */
const OUT_NAME = 'migrations';
const out = join(scratch, OUT_NAME);

let ok = false;
let detail = '';

try {
  // Only the ledger of what has been generated travels: no `*.sql` is copied, so
  // every `.sql` in the scratch afterwards was written by this run.
  cpSync(committedMeta, join(out, 'meta'), { recursive: true });

  const configPath = join(scratch, 'drizzle.drift.config.ts');
  // No import of `drizzle-kit` in the scratch config: it is resolved from a
  // directory outside the repo, and a config that cannot load would look exactly
  // like a clean tree.
  const config = [
    'export default {',
    "  dialect: 'postgresql',",
    `  schema: ${JSON.stringify(schemaEntry)},`,
    `  out: ${JSON.stringify(OUT_NAME)},`,
    '};',
    '',
  ].join('\n');
  writeFileSync(configPath, config);

  const generate = spawnSync(
    process.execPath,
    [join(repoRoot, 'node_modules', 'drizzle-kit', 'bin.cjs'), 'generate', '--config', configPath, '--name', 'drift'],
    {
      cwd: scratch,
      // stdin closed: drizzle-kit prompts on an ambiguous rename, and a check
      // that can block forever is a check that never runs in CI.
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const output = `${generate.stdout ?? ''}${generate.stderr ?? ''}`;

  const generated = readdirSync(out).filter((entry) => entry.endsWith('.sql'));
  /** drizzle-kit's own words for "the schema and the snapshot agree". */
  const saidNoChanges = /No schema changes, nothing to migrate/i.test(output);

  if (generate.status !== 0) {
    detail = `DRIFT unverifiable — drizzle-kit generate exited ${String(generate.status)}:\n${output.trim()}`;
  } else if (generated.length === 0 && !saidNoChanges) {
    // Neither a statement nor an all-clear: the tool did not answer the question.
    detail = `DRIFT unverifiable — drizzle-kit generate produced no verdict:\n${output.trim()}`;
  } else if (generated.length > 0) {
    const statements = generated
      .map((file) => readFileSync(join(out, file), 'utf8').trim())
      .join('\n')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');
    detail =
      `DRIFT — db/schema/ has ${String(statements.length)} statement(s) with no migration ` +
      `under db/migrations/. Generate one and commit it:\n${statements.join('\n')}`;
  } else {
    ok = true;
    detail = 'db/schema/ matches db/migrations/ — nothing to generate';
  }
} finally {
  // The scratch is this run's alone. A check that leaves scratch behind is a
  // check that eventually reads its own leftovers.
  rmSync(scratch, { recursive: true, force: true });
}

process.exitCode = summarise([report(FACT, ok, detail)]);
