#!/usr/bin/env node
/**
 * The drift check: does `db/schema/` still say what `db/migrations/` did?
 *
 * A report on the tree, never an edit to it. drizzle-kit is perfectly happy to
 * answer "they differ" by writing the missing migration, which would turn the
 * check that catches the mistake into the thing that hides it — so the committed
 * snapshots are copied into a scratch directory under $TMPDIR and drizzle-kit is
 * pointed there. Whatever it writes, it writes to scratch, and scratch is gone
 * before this process exits.
 *
 * The verdict is the exit code; the word DRIFT on its own line is for the human
 * reading the transcript.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(repoRoot, 'db', 'migrations');

const say = (line) => process.stdout.write(`${line}\n`);

/** Every `.sql` file drizzle-kit would have added, at the top of an out dir. */
const sqlIn = (directory) => readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();

const scratch = mkdtempSync(join(tmpdir(), 'vextrus-drift-'));

try {
  // Only the snapshots travel: drizzle-kit diffs the schema against `meta/`, and
  // the migration SQL itself is not an input to that diff.
  cpSync(join(migrationsDir, 'meta'), join(scratch, 'meta'), { recursive: true });

  const drizzleKit = join(repoRoot, 'node_modules', '.bin', 'drizzle-kit');
  const result = spawnSync(drizzleKit, ['generate', '--config', 'drizzle.config.ts'], {
    cwd: repoRoot,
    encoding: 'utf8',
    // stdin is closed: drizzle-kit must never sit waiting for an answer inside
    // `pnpm verify`. A question it cannot ask is a run that reached no verdict,
    // which is read below as "cannot prove no drift".
    stdio: ['ignore', 'pipe', 'pipe'],
    // drizzle-kit prefixes `out` with `./`, so an absolute scratch path becomes
    // `.//tmp/...` and it reads nothing. Relative from the repo root it is.
    env: { ...process.env, VDB_DRIZZLE_OUT: relative(repoRoot, scratch) },
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const generated = sqlIn(scratch);

  /**
   * drizzle-kit reports some failures — an unreadable snapshot, for one — on
   * stderr and still exits 0. A check that reads only the exit code would call
   * that a clean tree, which is the one answer it must never give by accident.
   * So a clean verdict has to be positively stated: it said there was nothing to
   * migrate, and it wrote nothing.
   */
  const saidNoChanges = /no schema changes/i.test(output);

  if (generated.length === 0 && (result.status !== 0 || !saidNoChanges)) {
    process.stdout.write(output.endsWith('\n') || output === '' ? output : `${output}\n`);
    say(
      `DRIFT — drizzle-kit reached no verdict comparing db/schema/ with db/migrations/ (exit ${String(result.status)})`,
    );
    process.exitCode = 1;
  } else if (generated.length > 0) {
    say(`DRIFT — db/schema/ has ${String(generated.length)} change(s) with no migration behind them`);
    for (const name of generated) {
      say(`  would generate ${name}:`);
      for (const line of readFileSync(join(scratch, name), 'utf8').trimEnd().split('\n')) {
        say(`    ${line}`);
      }
    }
    say('run `pnpm exec drizzle-kit generate --name <what-changed>` and commit the migration');
    process.exitCode = 1;
  } else {
    say('db/schema/ matches db/migrations/ — nothing to generate, and the tree was not touched');
  }
} catch (error) {
  say(`DRIFT — the drift check itself failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
