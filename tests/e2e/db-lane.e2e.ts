/**
 * V-DB: the database lane, driven end to end against a real scratch Postgres.
 *
 * Kept out of `pnpm test` on purpose (`*.e2e.ts`): it migrates a database and
 * shells out to `pnpm test:db` and `pnpm verify`, so it must never run inside
 * the verify run's own vitest stage.
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts tests/e2e/db-lane.e2e.ts
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { repoRoot, runCli } from '../acceptance/support/cli';
import {
  asBootstrap,
  asRole,
  discoverTenantTables,
  seam,
  seedFixture,
  syntheticInsert,
  type Fixture,
} from './support/db-lane';

const pnpm = (args: readonly string[], timeoutMs = 240_000) =>
  runCli('pnpm', args, {}, timeoutMs);

let fixture: Fixture;
let tables: string[];

beforeAll(async () => {
  // CHECKPOINT migrate — one migration per suite run (risk note 4).
  const migrated = pnpm(['db:migrate']);
  expect(migrated.status, `pnpm db:migrate failed:\n${migrated.output}`).toBe(0);
  tables = await discoverTenantTables();
  fixture = await seedFixture();
}, 300_000);

describe('AC-01 bootstrap and migrate', () => {
  test('CHECKPOINT idempotent — a second db:migrate exits 0 and applies nothing new', async () => {
    const before = await asRole('vextrus_migrate', 'select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(before.error, `ledger unreadable: ${String(before.error)}`).toBeUndefined();

    const again = pnpm(['db:migrate']);
    expect(again.status, again.output).toBe(0);

    const after = await asRole('vextrus_migrate', 'select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(after.rows[0]?.['n']).toBe(before.rows[0]?.['n']);
  });

  test('the three roles exist, none superuser, none BYPASSRLS', async () => {
    const catalog = await asBootstrap(
      `select rolname, rolsuper, rolbypassrls from pg_roles where rolname = any($1) order by rolname`,
      [['vextrus_app', 'vextrus_auth', 'vextrus_migrate']],
    );
    expect(catalog.rows.map((row) => row['rolname'])).toEqual([
      'vextrus_app',
      'vextrus_auth',
      'vextrus_migrate',
    ]);
    for (const row of catalog.rows) {
      expect(row['rolsuper'], `${String(row['rolname'])} is superuser`).toBe(false);
      expect(row['rolbypassrls'], `${String(row['rolname'])} bypasses RLS`).toBe(false);
    }
  });

  test('each role connects with its dev password (= its own name)', async () => {
    for (const role of ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'] as const) {
      const probe = await asRole(role, 'select current_user as who');
      expect(probe.error, `${role} could not connect: ${String(probe.error)}`).toBeUndefined();
      expect(probe.rows[0]?.['who']).toBe(role);
    }
  });
});

describe('AC-05 role-split', () => {
  test('vextrus_migrate owns every app table', async () => {
    const owners = await asRole(
      'vextrus_migrate',
      `select c.relname, pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')`,
    );
    expect(owners.rows.length).toBeGreaterThan(0);
    for (const row of owners.rows) {
      expect(row['owner'], `${String(row['relname'])} is not owned by the migrate role`).toBe(
        'vextrus_migrate',
      );
    }
  });

  test('vextrus_app and vextrus_auth cannot CREATE TABLE in the app schema', async () => {
    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const attempt = await asRole(role, 'create table role_split_probe (id int primary key)');
      expect(attempt.error, `${role} was allowed to create a table`).toMatch(/permission denied/i);
    }
  });

  test('forTenant and runAsSystem connect only as vextrus_app', async () => {
    const { forTenant, runAsSystem } = await seam();
    const scoped = await forTenant({ tenantId: fixture.a }).run(async (session) =>
      (await session.query('select current_user as who')).rows[0]?.['who'],
    );
    const system = await runAsSystem('acceptance: role check').run(async (session) =>
      (await session.query('select current_user as who')).rows[0]?.['who'],
    );
    expect(scoped).toBe('vextrus_app');
    expect(system).toBe('vextrus_app');
  });
});

describe('AC-02 the V-DB lane', () => {
  test('CHECKPOINT test:db — the lane exits 0 in 30s or less and names its facts', () => {
    // `--reporter=verbose` so the passing test titles reach stdout: the fact
    // names are the contract, and the default reporter prints only failures.
    const startedAt = Date.now();
    const result = pnpm(['test:db', '--reporter=verbose'], 120_000);
    const wallSeconds = (Date.now() - startedAt) / 1000;
    expect(result.status, result.output).toBe(0);
    expect(wallSeconds, `pnpm test:db took ${wallSeconds.toFixed(1)}s`).toBeLessThanOrEqual(30);

    for (const fact of [
      'scoped-read',
      'rls-refusal',
      'cross-tenant-write-refusal',
      'append-only-grants',
      'rls-coverage',
      'composite-fk-backstop',
      'role-split',
      'migration-ledger',
    ]) {
      expect(result.output, `no test names ${fact}`).toContain(fact);
    }
  });

  test('discovery finds both probe tables', () => {
    expect(tables).toContain('public.seam_probe_rows');
    expect(tables).toContain('public.seam_probe_ledger');
  });
});

describe('AC-03 scoped-read', () => {
  test('a row written through forTenant(A) is read back by A', async () => {
    const { forTenant } = await seam();
    const read = await forTenant({ tenantId: fixture.a }).run(async (session) =>
      (await session.query('select id from seam_probe_rows where id = $1', [fixture.rows['tenant-a']])).rows,
    );
    expect(read.length).toBe(1);
  });

  test("A's row is absent from every forTenant(B) read", async () => {
    const { forTenant } = await seam();
    const read = await forTenant({ tenantId: fixture.b }).run(async (session) =>
      (await session.query('select id from seam_probe_rows where id = $1', [fixture.rows['tenant-a']])).rows,
    );
    expect(read).toEqual([]);
  });

  test('every discovered table returns only the reading tenant rows', async () => {
    const { forTenant } = await seam();
    for (const table of tables) {
      for (const tenantId of [fixture.a, fixture.b]) {
        const rows = await forTenant({ tenantId }).run(async (session) =>
          (await session.query(`select tenant_id from ${table}`)).rows,
        );
        const foreign = rows.filter((row) => String(row['tenant_id']) !== tenantId);
        expect(foreign, `${table} leaked rows to tenant ${tenantId}`).toEqual([]);
      }
    }
  });

  test('AC-08 the tenant setting is transaction-local', async () => {
    const { forTenant } = await seam();
    const seen = await forTenant({ tenantId: fixture.a }).run(async (session) =>
      (await session.query(`select current_setting('app.tenant_id', true) as t`)).rows[0]?.['t'],
    );
    expect(seen).toBe(fixture.a);
  });
});

describe('AC-04 rls-refusal', () => {
  test('an unscoped vextrus_app SELECT returns zero rows on every discovered table', async () => {
    for (const table of tables) {
      const result = await asRole('vextrus_app', `select * from ${table}`);
      expect(result.error, `${table}: ${String(result.error)}`).toBeUndefined();
      expect(result.rows, `${table} returned rows without a tenant setting`).toEqual([]);
    }
  });

  test('an unscoped vextrus_app INSERT is refused by policy on every discovered table', async () => {
    let probed = 0;
    for (const table of tables) {
      const statement = await syntheticInsert(table, fixture.a);
      if (statement === undefined) continue; // a column type this probe cannot synthesise
      probed += 1;
      const attempt = await asRole('vextrus_app', statement);
      expect(attempt.error, `${table} accepted an unscoped insert`).toMatch(
        /row-level security|policy|permission denied/i,
      );
    }
    expect(probed, 'no discovered table could be probed with an insert').toBeGreaterThanOrEqual(2);
  });
});

describe('AC-04 cross-tenant-write-refusal', () => {
  test("forTenant(A) cannot INSERT a row owned by B", async () => {
    const { forTenant } = await seam();
    await expect(
      forTenant({ tenantId: fixture.a }).run(async (session) => {
        await session.query('insert into seam_probe_rows (id, tenant_id, label) values ($1, $2, $3)', [
          crypto.randomUUID(),
          fixture.b,
          'smuggled',
        ]);
      }),
    ).rejects.toThrow(/row-level security|policy|violates/i);
  });

  test("forTenant(A) cannot UPDATE a row's tenant_id to B", async () => {
    const { forTenant } = await seam();
    await expect(
      forTenant({ tenantId: fixture.a }).run(async (session) => {
        await session.query('update seam_probe_rows set tenant_id = $1 where id = $2', [
          fixture.b,
          fixture.rows['tenant-a'],
        ]);
      }),
    ).rejects.toThrow(/row-level security|policy|violates/i);
  });
});

describe('AC-06 append-only-grants', () => {
  test('seam_probe_ledger is tenant-scoped and append-only for the app role', async () => {
    expect(tables).toContain('public.seam_probe_ledger');
    const { forTenant } = await seam();

    const inserted = await forTenant({ tenantId: fixture.a }).run(async (session) => {
      await session.query(
        'insert into seam_probe_ledger (id, tenant_id, row_id, note) values ($1, $2, $3, $4)',
        [crypto.randomUUID(), fixture.a, fixture.rows['tenant-a'], 'append-only probe'],
      );
      return true;
    });
    expect(inserted).toBe(true);

    await expect(
      forTenant({ tenantId: fixture.a }).run(async (session) => {
        await session.query('update seam_probe_ledger set note = $1 where tenant_id = $2', [
          'rewritten',
          fixture.a,
        ]);
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      forTenant({ tenantId: fixture.a }).run(async (session) => {
        await session.query('delete from seam_probe_ledger where tenant_id = $1', [fixture.a]);
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  test('seam_probe_rows stays updatable through forTenant', async () => {
    const { forTenant } = await seam();
    const updated = await forTenant({ tenantId: fixture.a }).run(async (session) => {
      const result = await session.query(
        'update seam_probe_rows set label = $1 where id = $2 returning label',
        ['relabelled', fixture.rows['tenant-a']],
      );
      return result.rows[0]?.['label'];
    });
    expect(updated).toBe('relabelled');
  });
});

describe('AC-07 db:drift', () => {
  const BARREL = 'db/schema/index.ts';
  const PROBE = 'db/schema/drift-probe.ts';
  let barrelBefore = '';

  afterAll(() => {
    if (barrelBefore !== '') writeFileSync(join(repoRoot(), BARREL), barrelBefore, 'utf8');
    rmSync(join(repoRoot(), PROBE), { force: true });
  });

  test('exits 0 when db/schema/ matches db/migrations/', () => {
    const result = pnpm(['db:drift']);
    expect(result.status, result.output).toBe(0);
  });

  test('a schema change with no migration exits non-zero and prints DRIFT', () => {
    barrelBefore = readFileSync(join(repoRoot(), BARREL), 'utf8');
    writeFileSync(
      join(repoRoot(), PROBE),
      [
        "import { pgTable, uuid } from 'drizzle-orm/pg-core';",
        '',
        "export const driftProbe = pgTable('drift_probe', {",
        "  id: uuid('id').primaryKey(),",
        '});',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(repoRoot(), BARREL),
      `${barrelBefore}\nexport * from './drift-probe';\n`,
      'utf8',
    );

    const result = pnpm(['db:drift']);
    expect(result.status, `db:drift stayed green with an unmigrated table:\n${result.output}`).not.toBe(0);
    expect(result.output.split('\n').some((line) => line.includes('DRIFT'))).toBe(true);

    // AC-07: it generates into $TMPDIR — db/migrations/ is untouched by the check.
    const applied = pnpm(['exec', 'git', 'status', '--porcelain', 'db/migrations']);
    expect(applied.stdout.trim()).toBe('');
  });

  test('the verify db-drift stage fails exactly when db:drift would', () => {
    const diverged = runCli('pnpm', ['verify'], { VERIFY_ONLY: 'db-drift' });
    expect(diverged.output).toContain('== stage db-drift ==');
    expect(diverged.status, 'the db-drift stage passed on a diverged tree').not.toBe(0);

    writeFileSync(join(repoRoot(), BARREL), barrelBefore, 'utf8');
    rmSync(join(repoRoot(), PROBE), { force: true });

    const clean = runCli('pnpm', ['verify'], { VERIFY_ONLY: 'db-drift' });
    expect(clean.output).toContain('== stage db-drift ==');
    expect(clean.status, clean.output).toBe(0);
  });
});
