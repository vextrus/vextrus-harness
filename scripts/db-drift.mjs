#!/usr/bin/env node
/**
 * The drift check: does `db/schema/` still say what `db/migrations/` did?
 *
 * drizzle-kit answers that question by generating the migration the schema
 * *would* need — which is the one thing a check must never do to the tree. So it
 * generates into a scratch directory under $TMPDIR, seeded with a copy of the
 * committed snapshot, and this script reads the answer off what appeared there:
 * no SQL means the schema and the migrations agree, any SQL means a schema
 * change nobody wrote a migration for. `db/migrations/` is never opened for
 * writing, by anything, on either path.
 *
 * Two details are load-bearing.
 *
 * The `out` path is passed relative to the repo root. drizzle-kit prefixes it
 * with `./` when it goes looking for the snapshot, so an absolute path sends it
 * to `.//tmp/...`, where it finds nothing — and it exits 0 having generated
 * nothing, which reads exactly like a clean tree. That is the B-03 lie: a check
 * that is green because it never ran.
 *
 * So the verdict has to be positive, never inferred from an absence. A clean run
 * is drizzle-kit *saying* there are no schema changes; a dirty one is SQL on
 * disk. Anything else is no verdict at all, and no verdict is a failure.
 *
 * The marker line carries the token DRIFT so a caller — `pnpm verify`'s stage, a
 * CI log, a person — can find the verdict without parsing anything.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = './db/schema/index.ts';
const META = join(repoRoot, 'db', 'migrations', 'meta');

/** What drizzle-kit prints when the schema and the snapshot agree. */
const NOTHING_TO_MIGRATE = /no schema changes/i;

const say = (line) => process.stdout.write(`${line}\n`);

const scratch = mkdtempSync(join(tmpdir(), 'vextrus-drift-'));

/**
 * Reports a run that produced no usable answer, and returns its exit code.
 *
 * The marker carries DRIFT like every other failing verdict. A rename is the
 * case that makes this matter: drizzle-kit cannot tell it from a drop-and-add,
 * so it asks, and with no TTY it dies asking. That is a real divergence the
 * check could not name — not a clean tree — and a caller grepping for the token
 * must find it here too, or the divergence a reviewer most wants named is the
 * one that goes unmarked.
 */
const noVerdict = (why, result) => {
  say(`DRIFT undetermined — db:drift has no verdict: ${why}`);
  process.stdout.write(result?.stdout ?? '');
  process.stderr.write(result?.stderr ?? '');
  return result?.status === 0 || result?.status == null ? 1 : result.status;
};

try {
  if (!existsSync(META)) {
    process.exitCode = noVerdict('db/migrations/meta is missing, so there is no snapshot to compare against');
  } else {
    cpSync(META, join(scratch, 'meta'), { recursive: true });

    const kit = join(repoRoot, 'node_modules', '.bin', 'drizzle-kit');
    const generated = spawnSync(
      kit,
      ['generate', '--dialect=postgresql', `--schema=${SCHEMA}`, `--out=${relative(repoRoot, scratch)}`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        // No stdin: drizzle-kit prompts when a change is ambiguous, and a check
        // that can sit waiting for an answer nobody is there to give is a check
        // that hangs CI. Without a terminal it fails, and a failure is a result.
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      },
    );
    const transcript = `${generated.stdout ?? ''}${generated.stderr ?? ''}`;
    const sql = readdirSync(scratch)
      .filter((entry) => entry.endsWith('.sql'))
      .sort();

    if (generated.status !== 0) {
      process.exitCode = noVerdict(`drizzle-kit generate exited ${String(generated.status)}`, generated);
    } else if (sql.length > 0) {
      say(`DRIFT ${SCHEMA} has changes db/migrations/ does not: ${sql.join(', ')}`);
      say('The SQL below is what a migration would have to contain. Migrations are');
      say('append-only: add one under db/migrations/, never edit an applied one.');
      for (const file of sql) {
        say(`--- would generate ${file} ---`);
        say(readFileSync(join(scratch, file), 'utf8').trimEnd());
      }
      process.exitCode = 1;
    } else if (NOTHING_TO_MIGRATE.test(transcript)) {
      say(`db:drift — ${SCHEMA} matches db/migrations/, nothing to generate`);
    } else {
      process.exitCode = noVerdict(
        'drizzle-kit generated nothing and never said the schema was unchanged',
        generated,
      );
    }
  }
} finally {
  // The scratch belongs to this run and goes when the run does.
  rmSync(scratch, { recursive: true, force: true });
}
