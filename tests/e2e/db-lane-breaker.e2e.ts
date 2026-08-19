/**
 * Journey: what the seam promises when the unit of work does not go to plan.
 *
 * The green lane (`tests/e2e/db-lane.e2e.ts`, `db/__tests__/seam.test.ts`) proves
 * the happy paths and the refusals. These checkpoints are the other half: three
 * ways a caller can be told "your work is done" — or told nothing at all — while
 * the database disagrees.
 *
 * Live by definition, like every db-lane checkpoint: run with
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../acceptance/support/cli';
import { beforeAll, describe, expect, test } from 'vitest';

import {
  lit,
  loadSeam,
  pnpm,
  runSql,
  seedFixtures,
  uuid,
  withHandle,
  type SeamFixtures,
  type SeamModule,
} from './support/db-lane';

let seam: SeamModule;
let fixtures: SeamFixtures;

beforeAll(async () => {
  const migrated = pnpm(['db:migrate']);
  expect(migrated.status, `pnpm db:migrate must succeed:\n${migrated.output}`).toBe(0);
  seam = await loadSeam();
  fixtures = await seedFixtures();
}, 300_000);

describe('AC-08 — one transaction means one honest verdict', () => {
  /**
   * `commit` on a transaction Postgres has already marked aborted does not
   * fail: the server turns it into a rollback and answers as if all was well.
   * So a unit of work that catches a query error itself — the ordinary "try the
   * optional insert, carry on if it collides" shape — returns its value, the
   * handle resolves, and every write the work made is gone. The caller is told
   * the transaction committed. Nothing anywhere says otherwise.
   *
   * A handle whose whole contract is "your work runs in one transaction" has to
   * resolve only when that transaction actually committed; a discarded unit of
   * work is a failure, and a failure is a thrown error.
   */
  test('a unit of work whose transaction was aborted must not resolve as if it committed', async () => {
    const label = `breaker-silent-rollback-${uuid()}`;

    const outcome = await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), async (tx) => {
      await runSql(
        tx,
        `insert into seam_probe_rows (id, tenant_id, label)
         values (${lit(uuid())}, ${lit(fixtures.tenantA)}, ${lit(label)})`,
      );
      // The work handles a failing statement of its own and carries on. From
      // here the transaction is aborted, and only the seam can know that.
      try {
        await runSql(tx, 'select 1 / 0');
      } catch {
        /* the caller decided this one was survivable */
      }
      return 'work finished';
    }).then(
      (value) => ({ resolved: true, value }),
      (error: unknown) => ({ resolved: false, value: error instanceof Error ? error.message : String(error) }),
    );

    const surviving = await withHandle(seam.runAsSystem('breaker: did the write survive'), async (tx) =>
      runSql(tx, `select count(*)::int as n from seam_probe_rows where label = ${lit(label)}`),
    );
    const persisted = Number(surviving[0]?.['n'] ?? 0);

    // Either the work committed, or the caller learned that it did not.
    expect(
      { resolvedAsSuccess: outcome.resolved, rowsPersisted: persisted },
      `the handle returned ${JSON.stringify(outcome.value)} and the database kept ${persisted} row(s):` +
        ' a handle that resolves after its transaction was discarded reports a write that never happened',
    ).not.toEqual({ resolvedAsSuccess: true, rowsPersisted: 0 });
  });
});

describe('AC-03 — a tenant id is the tenant, however it was spelled', () => {
  /**
   * `tenant_id::text = current_setting('app.tenant_id', true)` is string
   * equality, and a uuid renders lower-case. Hand `forTenant` the same uuid in
   * upper case — the spelling Postgres itself accepts, and the one a header, a
   * JWT claim or a hand-typed id arrives in often enough — and the scope
   * silently addresses nobody: reads come back empty and writes are refused,
   * with no refusal from the seam saying why.
   *
   * Scoped read is the seam's first promise. An empty answer that means "you
   * spelled it differently" is the one answer it must never give.
   */
  test('an upper-case spelling of a tenant uuid scopes to that tenant, or is refused outright', async () => {
    const label = `breaker-case-${uuid()}`;
    await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), async (tx) => {
      await runSql(
        tx,
        `insert into seam_probe_rows (id, tenant_id, label)
         values (${lit(uuid())}, ${lit(fixtures.tenantA)}, ${lit(label)})`,
      );
    });

    const upper = fixtures.tenantA.toUpperCase();
    const outcome = await withHandle(seam.forTenant({ tenantId: upper }), async (tx) =>
      runSql(tx, `select count(*)::int as n from seam_probe_rows where label = ${lit(label)}`),
    ).then(
      (rows) => ({ refused: false, seen: Number(rows[0]?.['n'] ?? 0) }),
      () => ({ refused: true, seen: -1 }),
    );

    expect(
      outcome,
      'forTenant answered a valid uuid for tenant-a with an empty tenant instead of' +
        " tenant-a's rows or a refusal",
    ).not.toEqual({ refused: false, seen: 0 });
  });
});

describe('AC-07 — every divergence says DRIFT, not only the easy ones', () => {
  /**
   * A renamed column is the divergence a reviewer most wants named: the schema
   * says `caption`, the migrations say `label`, and nobody wrote the migration
   * in between. drizzle-kit cannot tell a rename from a drop-and-add on its own,
   * so it asks — and with no TTY it dies asking. `db:drift` reads that as "no
   * verdict", which is the right instinct and the right exit code, but the
   * transcript then carries no line containing DRIFT.
   *
   * AC-07 makes the marker the contract: a caller, a CI log or a person finds
   * the verdict by looking for the token. A divergence that exits non-zero
   * without it is a verdict nobody can grep for.
   */
  test('a renamed column is reported with a DRIFT line, like every other divergence', () => {
    const tenancyPath = join(repoRoot(), 'db', 'schema', 'tenancy.ts');
    const original = readFileSync(tenancyPath, 'utf8');
    const renamed = original.replace("label: text('label')", "label: text('caption')");
    expect(renamed, 'the fixture must actually rename a column').not.toBe(original);

    const migrations = (): string => pnpm(['exec', 'git', 'ls-files', '-s', 'db/migrations']).stdout;
    /**
     * The transcript of a no-verdict run carries drizzle-kit's own stack. Quoted
     * verbatim into a failure message it is read back as this test's stack, and
     * the reporter dies resolving a source map inside `bin.cjs` — a green-looking
     * crash on top of the failure it was trying to explain. So the frames go.
     */
    const readable = (transcript: string): string =>
      transcript
        .split('\n')
        .filter((line) => !/^\s*at\s/.test(line))
        .join('\n');
    const before = migrations();
    writeFileSync(tenancyPath, renamed, 'utf8');
    try {
      const result = pnpm(['db:drift']);
      expect(result.status, `db:drift must refuse a renamed column:\n${readable(result.output)}`).not.toBe(0);
      expect(migrations(), 'db:drift must not write into db/migrations/').toBe(before);
      const marker = result.output.split('\n').find((line) => line.includes('DRIFT'));
      expect(
        marker,
        `the output must carry a line containing DRIFT:\n${readable(result.output)}`,
      ).toBeDefined();
    } finally {
      writeFileSync(tenancyPath, original, 'utf8');
    }
  }, 300_000);
});

describe('AC-08 — a pool size the seam cannot honour is a refusal, not a silence', () => {
  /**
   * `VDB_POOL_SIZE` follows the exported-but-empty convention: an empty value
   * falls back to the default. A *negative* one does not — it reaches `pg` as
   * `max: -1`, the pool never hands out a client, and the handle's promise never
   * settles. No error, no timeout, no log: every query in the process simply
   * stops, which is the failure mode hardest to read from outside.
   *
   * Whatever the seam does with a value it cannot honour — fall back to the
   * default, as the empty case already does, or refuse it loudly — it has to do
   * something a caller can observe.
   */
  test('a negative VDB_POOL_SIZE does not hang the seam forever', () => {
    const script = `
      const { forTenant } = await import('./src/core/db.ts');
      const rows = await forTenant({ tenantId: process.argv[1] })(async (tx) =>
        (await tx.query('select 1 as n')).rows);
      console.log('SEAM_ANSWERED ' + rows[0].n);
      process.exit(0);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, fixtures.tenantA], {
      cwd: repoRoot(),
      encoding: 'utf8',
      env: { ...process.env, VDB_POOL_SIZE: '-1' },
      timeout: 20_000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    const answered = /SEAM_ANSWERED/.test(output);
    const refused = !answered && /Error|refus/i.test(output);
    expect(
      { answered, refused },
      `the seam neither answered nor refused with VDB_POOL_SIZE=-1 — it hung (exit ${String(result.status)}, signal ${String(result.signal)}):\n${output}`,
    ).not.toEqual({ answered: false, refused: false });
  });
});
