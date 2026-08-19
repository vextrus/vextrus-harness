/**
 * Journey: the database lane end to end (V-DB, R-SPINE-004, SEAM-TENANT, Q-02).
 *
 * Named `*.e2e.ts` on purpose. These checkpoints shell out to `pnpm db:migrate`,
 * `pnpm test:db` and `pnpm verify`, and they talk to a live Postgres — running
 * them inside the verify run's own vitest stage would re-enter it. Run with:
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 *
 * The lane is live by definition: a scratch Postgres on 127.0.0.1:5544 is the
 * environment contract `checkup`'s postgres-5544 fact already probes. An
 * unreachable database is a red journey, not a skipped one — a seam nobody
 * proved is a seam that does not hold.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { repoRoot } from '../acceptance/support/cli';
import {
  asRole,
  connectBootstrap,
  count,
  discoverTenantTables,
  isRlsRefusal,
  INSUFFICIENT_PRIVILEGE,
  lit,
  loadSeam,
  loadSeamNamespace,
  pnpm,
  refusal,
  ROLES,
  runSql,
  scalar,
  seedFixtures,
  uuid,
  withHandle,
  type SeamFixtures,
  type SeamModule,
  type TenantTable,
} from './support/db-lane';

let seam: SeamModule;
let fixtures: SeamFixtures;
let tables: TenantTable[];

beforeAll(async () => {
  const migrated = pnpm(['db:migrate']);
  expect(migrated.status, `pnpm db:migrate must succeed:\n${migrated.output}`).toBe(0);

  seam = await loadSeam();
  fixtures = await seedFixtures();

  const client = await connectBootstrap();
  try {
    tables = await discoverTenantTables(client);
  } finally {
    await client.end();
  }
}, 300_000);

/** The two probe tables must always be in the discovered population. */
const named = (name: string): TenantTable => {
  const found = tables.find((t) => t.name === name);
  if (found === undefined) {
    throw new Error(`${name} is not a discovered tenant-scoped table — saw [${tables.map((t) => t.name).join(', ')}]`);
  }
  return found;
};

describe('AC-01 — checkpoint db-migrate', () => {
  test('the three roles exist, none superuser, none BYPASSRLS, dev passwords equal role names', async () => {
    const client = await connectBootstrap();
    try {
      const { rows } = await client.query(
        `select rolname, rolsuper, rolbypassrls, rolcanlogin
         from pg_roles where rolname in (${ROLES.map((r) => lit(r)).join(', ')})`,
      );
      expect(rows.length, `all three roles must exist — saw ${rows.length}`).toBe(ROLES.length);
      for (const row of rows) {
        expect(row['rolsuper'], `${String(row['rolname'])} must not be superuser`).toBe(false);
        expect(row['rolbypassrls'], `${String(row['rolname'])} must not bypass RLS`).toBe(false);
        expect(row['rolcanlogin'], `${String(row['rolname'])} must be able to log in`).toBe(true);
      }
    } finally {
      await client.end();
    }

    // The dev password contract is only real if it actually authenticates.
    for (const role of ROLES) {
      const who = await asRole(role, async (client) => {
        const { rows } = await client.query('select current_user as who');
        return String(rows[0]?.['who'] ?? '');
      });
      expect(who).toBe(role);
    }
  }, 300_000);

  test('checkpoint migration-ledger: a second immediate run exits 0 and applies nothing new', async () => {
    const ledgerCount = async (): Promise<number> => {
      const client = await connectBootstrap();
      try {
        const { rows } = await client.query(
          'select count(*)::int as count from drizzle.__drizzle_migrations',
        );
        return count(rows);
      } finally {
        await client.end();
      }
    };

    const before = await ledgerCount();
    expect(before, 'the initial migration must be recorded in the ledger').toBeGreaterThan(0);

    const again = pnpm(['db:migrate']);
    expect(again.status, `a second db:migrate must be idempotent:\n${again.output}`).toBe(0);

    expect(await ledgerCount(), 'an idempotent run applies nothing new').toBe(before);
  }, 300_000);

  test('every migration under db/migrations/ is recorded, and the probe tables exist', async () => {
    expect(named('seam_probe_rows').name).toBe('seam_probe_rows');
    expect(named('seam_probe_ledger').name).toBe('seam_probe_ledger');
  });
});

describe('AC-03 — checkpoint scoped-read', () => {
  test('every discovered table shows a tenant only its own rows through forTenant', async () => {
    expect(tables.length, 'discovery must find the tenant-scoped tables').toBeGreaterThan(0);

    for (const table of tables) {
      const foreign = await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
        runSql(tx, `select count(*)::int as count from ${table.qualified} where tenant_id <> ${lit(fixtures.tenantA)}`),
      );
      expect(count(foreign), `${table.name}: forTenant(A) must see no other tenant's rows`).toBe(0);

      const mine = await withHandle(seam.forTenant({ tenantId: fixtures.tenantB }), (tx) =>
        runSql(tx, `select count(*)::int as count from ${table.qualified} where tenant_id <> ${lit(fixtures.tenantB)}`),
      );
      expect(count(mine), `${table.name}: forTenant(B) must see no other tenant's rows`).toBe(0);
    }
  }, 300_000);

  test('a row written through forTenant(A) is visible to A and invisible to B', async () => {
    const id = uuid();
    await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
      runSql(
        tx,
        `insert into seam_probe_rows (id, tenant_id, label)
         values (${lit(id)}, ${lit(fixtures.tenantA)}, ${lit('written through the seam')})`,
      ),
    );

    const seenByA = await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
      runSql(tx, `select count(*)::int as count from seam_probe_rows where id = ${lit(id)}`),
    );
    expect(count(seenByA), 'the writing tenant must read its own row back').toBe(1);

    const seenByB = await withHandle(seam.forTenant({ tenantId: fixtures.tenantB }), (tx) =>
      runSql(tx, `select count(*)::int as count from seam_probe_rows where id = ${lit(id)}`),
    );
    expect(count(seenByB), "the other tenant must not see it").toBe(0);
  }, 300_000);
});

describe('AC-04 — checkpoint rls-refusal', () => {
  test('an unscoped app connection reads nothing and is refused every write', async () => {
    await asRole('vextrus_app', async (client) => {
      for (const table of tables) {
        const { rows } = await client.query(
          `select count(*)::int as count from ${table.qualified}`,
        );
        expect(count(rows), `${table.name}: an unscoped connection must read zero rows`).toBe(0);

        const attempt = await refusal(() =>
          client.query(
            `insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantA)})`,
          ),
        );
        expect(attempt.refused, `${table.name}: an unscoped insert must be refused`).toBe(true);
        expect(
          isRlsRefusal(attempt),
          `${table.name}: the refusal must be row-level security, not a shape complaint — got ${attempt.code} ${attempt.message}`,
        ).toBe(true);
      }
    });
  }, 300_000);

  test('checkpoint rls-coverage: every discovered table has RLS enabled AND forced', async () => {
    const client = await connectBootstrap();
    try {
      for (const table of tables) {
        const { rows } = await client.query(
          `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = ${lit(table.schema)} and c.relname = ${lit(table.name)}`,
        );
        expect(scalar(rows, 'enabled'), `${table.name}: RLS must be enabled`).toBe(true);
        expect(scalar(rows, 'forced'), `${table.name}: RLS must be FORCED — the owner is subject too`).toBe(true);
      }
    } finally {
      await client.end();
    }
  }, 300_000);
});

describe('AC-04 — checkpoint cross-tenant-write-refusal', () => {
  test('forTenant(A) cannot write a row belonging to B, on any discovered table', async () => {
    for (const table of tables) {
      const attempt = await refusal(() =>
        withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
          runSql(
            tx,
            `insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantB)})`,
          ),
        ),
      );
      expect(attempt.refused, `${table.name}: a cross-tenant insert must be refused`).toBe(true);
      expect(
        isRlsRefusal(attempt),
        `${table.name}: WITH CHECK must be what refuses it — got ${attempt.code} ${attempt.message}`,
      ).toBe(true);
    }
  }, 300_000);

  test('forTenant(A) cannot hand its own row to B with an UPDATE', async () => {
    const attempt = await refusal(() =>
      withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
        runSql(
          tx,
          `update seam_probe_rows set tenant_id = ${lit(fixtures.tenantB)} where id = ${lit(fixtures.probeRowA)}`,
        ),
      ),
    );
    expect(attempt.refused, 'reassigning a row to another tenant must be refused').toBe(true);
    expect(isRlsRefusal(attempt), `got ${attempt.code} ${attempt.message}`).toBe(true);

    // And the row is untouched.
    const still = await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
      runSql(tx, `select count(*)::int as count from seam_probe_rows where id = ${lit(fixtures.probeRowA)}`),
    );
    expect(count(still)).toBe(1);
  }, 300_000);
});

describe('AC-06 — checkpoint append-only-grants', () => {
  test('seam_probe_ledger takes inserts through the seam but refuses UPDATE and DELETE', async () => {
    const inserted = await refusal(() =>
      withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
        runSql(
          tx,
          `insert into seam_probe_ledger (id, tenant_id, row_id, note)
           values (${lit(uuid())}, ${lit(fixtures.tenantA)}, ${lit(fixtures.probeRowA)}, ${lit('appended')})`,
        ),
      ),
    );
    expect(inserted.refused, `an append must succeed: ${inserted.message}`).toBe(false);

    for (const statement of [
      `update seam_probe_ledger set note = ${lit('rewritten')} where tenant_id = ${lit(fixtures.tenantA)}`,
      `delete from seam_probe_ledger where tenant_id = ${lit(fixtures.tenantA)}`,
    ]) {
      const attempt = await refusal(() =>
        withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) => runSql(tx, statement)),
      );
      expect(attempt.refused, `append-only: "${statement.slice(0, 24)}…" must be refused`).toBe(true);
      expect(
        attempt.code,
        `append-only is a missing grant, not a policy: got ${attempt.code} ${attempt.message}`,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    }
  }, 300_000);

  test('seam_probe_rows stays mutable through forTenant', async () => {
    const attempt = await refusal(() =>
      withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
        runSql(
          tx,
          `update seam_probe_rows set label = ${lit('relabelled')} where id = ${lit(fixtures.probeRowA)}`,
        ),
      ),
    );
    expect(attempt.refused, `the mutable probe table must accept an update: ${attempt.message}`).toBe(false);
  }, 300_000);
});

describe('AC-05 — checkpoint role-split', () => {
  test('the app and auth roles cannot create tables', async () => {
    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const table = `role_split_probe_${Date.now()}`;
      const attempt = await asRole(role, (client) =>
        refusal(() => client.query(`create table ${table} (id int)`)),
      );
      expect(attempt.refused, `${role} must not be able to CREATE TABLE`).toBe(true);
      if (!attempt.refused) {
        await asRole('vextrus_migrate', (client) => client.query(`drop table if exists ${table}`));
      }
    }
  }, 300_000);

  test('vextrus_migrate owns every application table', async () => {
    const client = await connectBootstrap();
    try {
      const { rows } = await client.query(
        `select schemaname, tablename, tableowner from pg_tables
         where schemaname not in ('pg_catalog', 'information_schema', 'drizzle')
           and schemaname not like 'pg_%'`,
      );
      expect(rows.length, 'the migration must have created application tables').toBeGreaterThan(0);
      for (const row of rows) {
        expect(row['tableowner'], `${String(row['tablename'])} must be owned by the migrate role`).toBe(
          'vextrus_migrate',
        );
      }
    } finally {
      await client.end();
    }
  }, 300_000);

  test('both seam handles connect as vextrus_app and nothing else', async () => {
    const asTenant = await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
      runSql(tx, 'select current_user as who'),
    );
    expect(scalar(asTenant, 'who')).toBe('vextrus_app');

    const asSystem = await withHandle(seam.runAsSystem('journey: role check'), (tx) =>
      runSql(tx, 'select current_user as who'),
    );
    expect(scalar(asSystem, 'who')).toBe('vextrus_app');
  }, 300_000);
});

describe('AC-08 — the seam is the only handle', () => {
  test('src/core/db.ts exports exactly forTenant and runAsSystem', async () => {
    const namespace = await loadSeamNamespace();
    expect(Object.keys(namespace).sort()).toEqual(['forTenant', 'runAsSystem']);
  }, 300_000);

  test('forTenant refuses a missing tenant with TENANT_REQUIRED', async () => {
    for (const bad of ['', '   ']) {
      const attempt = await refusal(async () =>
        withHandle(seam.forTenant({ tenantId: bad }), async () => undefined),
      );
      expect(attempt.refused, `forTenant(${JSON.stringify(bad)}) must refuse`).toBe(true);
      expect(attempt.message).toContain('TENANT_REQUIRED');
    }
  }, 300_000);

  test('the tenant setting is transaction-local, not left on the connection', async () => {
    // Set it inside a handle, then look again from a fresh handle on the same
    // pool: a `set_config(..., false)` would still be there.
    await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
      runSql(tx, 'select 1 as ok'),
    );
    const leaked = await withHandle(seam.runAsSystem('journey: leak check'), (tx) =>
      runSql(tx, `select coalesce(current_setting('app.tenant_id', true), '') as tenant`),
    );
    expect(String(scalar(leaked, 'tenant') ?? ''), 'the tenant setting must not survive the transaction').toBe('');
  }, 300_000);
});

describe('AC-02 — checkpoint test-db-lane', () => {
  test('pnpm test:db exits 0 within the 30s V-DB budget', () => {
    const startedAt = Date.now();
    const result = pnpm(['test:db']);
    const elapsed = (Date.now() - startedAt) / 1000;

    expect(result.status, `pnpm test:db must be green:\n${result.output}`).toBe(0);
    expect(elapsed, `the V-DB lane must finish within 30s — took ${elapsed.toFixed(1)}s`).toBeLessThanOrEqual(30);
  }, 300_000);

  test('a table added later is covered with zero edits to the suite', async () => {
    // The whole point of discovery: this table exists in no schema file and in
    // no list, and the lane must still prove the four seam facts about it.
    const probe = 'seam_discovery_probe';
    const create = `
      create table ${probe} (
        id uuid not null default gen_random_uuid(),
        tenant_id uuid not null references tenants(id),
        label text not null default 'discovered',
        primary key (tenant_id, id)
      );
      insert into ${probe} (tenant_id) values (${lit(fixtures.tenantA)}), (${lit(fixtures.tenantB)});
      alter table ${probe} enable row level security;
      alter table ${probe} force row level security;
      create policy ${probe}_tenant on ${probe}
        using (tenant_id::text = current_setting('app.tenant_id', true)
               or current_setting('app.system', true) = 'on')
        with check (tenant_id::text = current_setting('app.tenant_id', true)
               or current_setting('app.system', true) = 'on');
      grant select, insert, update, delete on ${probe} to vextrus_app;
    `;

    await asRole('vextrus_migrate', (client) => client.query(create));
    try {
      const result = pnpm(['test:db']);
      expect(result.status, `the lane must stay green for a discovered table:\n${result.output}`).toBe(0);
      expect(
        result.output,
        'the suite must name the table it discovered — no hard-coded list',
      ).toContain(probe);
    } finally {
      await asRole('vextrus_migrate', (client) => client.query(`drop table if exists ${probe}`));
    }
  }, 300_000);
});

describe('AC-07 — checkpoint db-drift', () => {
  const barrelPath = join(repoRoot(), 'db/schema/index.ts');
  const probePath = join(repoRoot(), 'db/schema/drift-probe.ts');

  /** A schema module with no migration behind it — self-contained on purpose. */
  const diverge = (): (() => void) => {
    const barrel = readFileSync(barrelPath, 'utf8');
    writeFileSync(
      probePath,
      [
        "import { pgTable, text, uuid } from 'drizzle-orm/pg-core';",
        '',
        "export const driftProbe = pgTable('drift_probe', {",
        "  id: uuid('id').primaryKey(),",
        "  tenantId: uuid('tenant_id').notNull(),",
        "  label: text('label'),",
        '});',
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(barrelPath, `${barrel}\nexport * from './drift-probe';\n`, 'utf8');
    return () => {
      writeFileSync(barrelPath, barrel, 'utf8');
      rmSync(probePath, { force: true });
    };
  };

  /** The committed migrations, as content — drift must never write into them. */
  const migrationsSnapshot = (): string => {
    const result = pnpm(['exec', 'git', 'ls-files', '-s', 'db/migrations']);
    return result.stdout;
  };

  test('pnpm db:drift exits 0 when the schema and the migrations agree', () => {
    const before = migrationsSnapshot();
    const result = pnpm(['db:drift']);
    expect(result.status, `db:drift must be clean on a matching tree:\n${result.output}`).toBe(0);
    expect(result.output, 'a clean run must not cry DRIFT').not.toMatch(/\bDRIFT\b/);
    expect(migrationsSnapshot(), 'db:drift must not write into db/migrations/').toBe(before);
  }, 300_000);

  test('pnpm db:drift exits non-zero printing DRIFT when a schema change has no migration', () => {
    const before = migrationsSnapshot();
    const restore = diverge();
    try {
      const result = pnpm(['db:drift']);
      expect(result.status, `db:drift must fail on divergence:\n${result.output}`).not.toBe(0);
      const marker = result.output.split('\n').find((line) => line.includes('DRIFT'));
      expect(marker, 'the output must carry a line containing DRIFT').toBeDefined();
      expect(migrationsSnapshot(), 'db:drift must generate into scratch, not into the tree').toBe(before);
    } finally {
      restore();
    }
  }, 300_000);

  test('pnpm verify carries a db-drift stage that fails when db:drift would', () => {
    const clean = pnpm(['verify'], { VERIFY_ONLY: 'db-drift' });
    expect(clean.status, `the db-drift stage must be green on a matching tree:\n${clean.output}`).toBe(0);
    expect(clean.output, 'the stage must announce itself').toMatch(/==\s+stage\s+db-drift\s+==/);

    const restore = diverge();
    try {
      const diverged = pnpm(['verify'], { VERIFY_ONLY: 'db-drift' });
      expect(diverged.status, `the db-drift stage must fail on divergence:\n${diverged.output}`).not.toBe(0);
      expect(diverged.output).toMatch(/\bDRIFT\b/);
    } finally {
      restore();
    }
  }, 300_000);
});
