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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { report, summarise } from './lib/report.mjs';

const FACT = 'db-drift';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaEntry = join(repoRoot, 'db', 'schema', 'index.ts');
const migrationsDir = join(repoRoot, 'db', 'migrations');
const committedMeta = join(migrationsDir, 'meta');

const scratch = mkdtempSync(join(tmpdir(), 'vextrus-drift-'));

/**
 * One drizzle-kit run in a scratch directory of its own.
 *
 * drizzle-kit resolves `out` against the process cwd whatever it is given — an
 * absolute path becomes `.//tmp/...`, it cannot find the snapshot, and it exits
 * *0* having generated nothing, which reads exactly like a clean tree. So every
 * run happens from inside the scratch directory with a relative `out`, and the
 * verdict is read positively from what it wrote rather than from "nothing was
 * written".
 *
 * `seedMeta` is what makes the two questions below different runs of the same
 * command: with the committed snapshot in place, drizzle-kit writes the
 * statements that are *missing* from the lane; with no snapshot at all, it
 * writes the whole of what `db/schema/` says the database should be.
 */
function generateInto(name, seedMeta) {
  const out = join(scratch, name);
  mkdirSync(out, { recursive: true });
  if (seedMeta) {
    // Only the ledger of what has been generated travels: no `*.sql` is copied,
    // so every `.sql` in the scratch afterwards was written by this run.
    cpSync(committedMeta, join(out, 'meta'), { recursive: true });
  }

  const configPath = join(scratch, `drizzle.${name}.config.ts`);
  // No import of `drizzle-kit` in the scratch config: it is resolved from a
  // directory outside the repo, and a config that cannot load would look exactly
  // like a clean tree.
  const config = [
    'export default {',
    "  dialect: 'postgresql',",
    `  schema: ${JSON.stringify(schemaEntry)},`,
    `  out: ${JSON.stringify(name)},`,
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
  const files = readdirSync(out).filter((entry) => entry.endsWith('.sql'));
  return {
    status: generate.status,
    output,
    files,
    sql: files.map((file) => readFileSync(join(out, file), 'utf8')).join('\n'),
  };
}

/** Every `.sql` the migration lane actually applies, as one body of text. */
function committedMigrationSql() {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'meta')
    .map((entry) => entry.name)
    .sort();
  return dirs
    .flatMap((dir) =>
      readdirSync(join(migrationsDir, dir))
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => readFileSync(join(migrationsDir, dir, file), 'utf8')),
    )
    .join('\n');
}

/**
 * SQL with its comments removed and its noise flattened, so a statement that was
 * commented out counts as the absence it is, and `"seam_probe_rows"` matches
 * `public.seam_probe_rows`.
 */
function normalise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * The RLS `db/schema/` declares: which tables enable row level security, and
 * which policies exist on them (layout-db — "RLS declared in schema").
 */
function declaredSecurity(fullSql) {
  const rlsTables = [...fullSql.matchAll(/ALTER TABLE\s+"?([\w.]+)"?\s+ENABLE ROW LEVEL SECURITY/gi)].map(
    (match) => match[1].replace(/^public\./i, ''),
  );
  const policies = [...fullSql.matchAll(/CREATE POLICY\s+"([^"]+)"\s+ON\s+"?([\w.]+)"?/gi)].map(
    (match) => ({ name: match[1], table: match[2].replace(/^public\./i, '') }),
  );
  return { rlsTables, policies };
}

const OUT_NAME = 'migrations';

let ok = false;
let detail = '';

try {
  // Question one: is there a statement `db/schema/` implies that no migration
  // under db/migrations/ has ever carried?
  const pending = generateInto(OUT_NAME, true);
  /** drizzle-kit's own words for "the schema and the snapshot agree". */
  const saidNoChanges = /No schema changes, nothing to migrate/i.test(pending.output);

  if (pending.status !== 0) {
    detail = `DRIFT unverifiable — drizzle-kit generate exited ${String(pending.status)}:\n${pending.output.trim()}`;
  } else if (pending.files.length === 0 && !saidNoChanges) {
    // Neither a statement nor an all-clear: the tool did not answer the question.
    detail = `DRIFT unverifiable — drizzle-kit generate produced no verdict:\n${pending.output.trim()}`;
  } else if (pending.files.length > 0) {
    const statements = pending.sql
      .trim()
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');
    detail =
      `DRIFT — db/schema/ has ${String(statements.length)} statement(s) with no migration ` +
      `under db/migrations/. Generate one and commit it:\n${statements.join('\n')}`;
  } else {
    /**
     * Question two: does the SQL the lane actually applies still *say* what
     * `db/schema/` declares?
     *
     * The snapshot in `db/migrations/meta/` is drizzle-kit's bookkeeping, not the
     * migration — every `ENABLE ROW LEVEL SECURITY` and every `CREATE POLICY`
     * could be deleted from `db/migrations/0000_init/0000_schema.sql` and
     * question one would still say clean, over a lane that builds a database
     * with no row level security in it at all. So the whole of the schema is
     * generated a second time, from no snapshot, and its security declarations
     * are looked for in the SQL the lane applies. A declaration that is in the
     * schema and not in the lane is drift in the direction that matters most.
     */
    const full = generateInto('full', false);
    if (full.status !== 0 || full.files.length === 0) {
      detail =
        `DRIFT unverifiable — drizzle-kit could not render db/schema/ in full ` +
        `(exit ${String(full.status)}):\n${full.output.trim()}`;
    } else {
      const { rlsTables, policies } = declaredSecurity(full.sql);
      const lane = normalise(committedMigrationSql());
      const missing = [
        ...rlsTables
          .filter(
            (table) =>
              !new RegExp(`alter table (public\\.)?${table} enable row level security`).test(lane),
          )
          .map((table) => `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
        ...policies
          .filter(
            (policy) =>
              !new RegExp(
                `create policy ${policy.name.toLowerCase()} on (public\\.)?${policy.table}`,
              ).test(lane),
          )
          .map((policy) => `CREATE POLICY ${policy.name} ON ${policy.table}`),
      ];

      if (missing.length > 0) {
        detail =
          `DRIFT — db/schema/ declares ${String(missing.length)} security statement(s) that no ` +
          `migration under db/migrations/ applies. The lane would build a database without ` +
          `them:\n${missing.join('\n')}`;
      } else {
        ok = true;
        detail =
          `db/schema/ matches db/migrations/ — nothing to generate, and the lane applies all ` +
          `${String(rlsTables.length)} RLS declaration(s) and ${String(policies.length)} policy(ies)`;
      }
    }
  }
} finally {
  // The scratch is this run's alone. A check that leaves scratch behind is a
  // check that eventually reads its own leftovers.
  rmSync(scratch, { recursive: true, force: true });
}

process.exitCode = summarise([report(FACT, ok, detail)]);
