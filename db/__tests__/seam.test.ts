/**
 * V-DB: the live seam suite. It proves SEAM-TENANT against a migrated Postgres,
 * table by table, and it is told about none of them.
 *
 * Discovery is the design (AC-02). The suite asks the catalog which tables carry
 * a `tenant_id` column — outside the migration ledger and the system schemas —
 * and holds every one of them to the same facts:
 *
 *     scoped-read · rls-refusal · cross-tenant-write-refusal ·
 *     append-only-grants (where declared) · rls-coverage
 *
 * So a later increment adds a table and this file does not change: the new table
 * joins the population automatically, and a table that arrives without forced
 * RLS turns the lane red by construction. The held-out `rls_gap` probe below is
 * that claim proved rather than asserted — a tenant-scoped table with no RLS
 * really does fail the coverage check.
 *
 * The rest are the facts that are about the lane rather than about one table:
 * the composite-FK backstop that holds even under `runAsSystem`, the role split
 * proved by connecting as each of the three roles, and the migration ledger no
 * runtime role can touch.
 *
 * Everything here runs against the database `pnpm db:migrate` produced; the
 * suite migrates nothing, because the 30s budget is one migration per lane, not
 * one per test.
 */
import pg from 'pg';
import { afterAll, describe, expect, test } from 'vitest';

import { APPEND_ONLY_TABLES } from '../schema/index';
import { forTenant, runAsSystem } from '../../src/core/db';

/* ------------------------------------------------------------------ roles */

const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'] as const;
type RoleName = (typeof ROLES)[number];

const env = (name: string, fallback: string): string => {
  const raw = (process.env[name] ?? '').trim();
  return raw === '' ? fallback : raw;
};

const BOOTSTRAP_URL = env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');
const DATABASE = env('VDB_PG_DATABASE', 'vextrus_dev');

/** Dev passwords equal the role names, so a role's URL is derivable. */
function roleUrl(role: RoleName): string {
  const url = new URL(BOOTSTRAP_URL);
  url.username = role;
  url.password = role;
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

const clients: pg.Client[] = [];

/** A raw connection as one role — the checks that must happen outside the seam. */
async function connectAs(role: RoleName): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: roleUrl(role) });
  await client.connect();
  clients.push(client);
  return client;
}

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
});

/* -------------------------------------------------------------- sql values */

/** A single-quoted SQL literal. Every value inlined here is minted by this file. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const uuid = (): string => crypto.randomUUID();

interface SqlRow {
  readonly [column: string]: unknown;
}

const rowsOf = (result: pg.QueryResult): SqlRow[] => result.rows as SqlRow[];
const scalar = (rows: SqlRow[], column: string): unknown => rows[0]?.[column];
const count = (rows: SqlRow[]): number => Number(scalar(rows, 'count') ?? 0);

interface Refusal {
  readonly refused: boolean;
  readonly code: string;
  readonly message: string;
}

/** Runs `attempt` and reports how the database refused it, if it did. */
async function refusal(attempt: () => Promise<unknown>): Promise<Refusal> {
  try {
    await attempt();
    return { refused: false, code: '', message: '' };
  } catch (error) {
    const holder: Record<string, unknown> =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
    const code = typeof holder['code'] === 'string' ? holder['code'] : '';
    return { refused: true, code, message: error instanceof Error ? error.message : String(error) };
  }
}

/** SQLSTATE 42501 — a policy refusal and a missing grant are the same refusal. */
const INSUFFICIENT_PRIVILEGE = '42501';
/** SQLSTATE 23503 — the foreign key said no. */
const FOREIGN_KEY_VIOLATION = '23503';

/* ------------------------------------------------------------- the fixtures */

const TENANT_A_SLUG = 'tenant-a';
const TENANT_B_SLUG = 'tenant-b';

interface Fixtures {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly probeRowA: string;
  readonly probeRowB: string;
}

/** Seeded through the system seam — the only route that has no tenant scope. */
async function seed(): Promise<Fixtures> {
  await runAsSystem('test:db seed tenants').run(async (tx) => {
    for (const slug of [TENANT_A_SLUG, TENANT_B_SLUG]) {
      await tx.query(
        `insert into tenants (id, slug, name) values (${lit(uuid())}, ${lit(slug)}, ${lit(slug)})
         on conflict (slug) do nothing`,
      );
    }
  });

  const ids = await runAsSystem('test:db read tenant ids').run(async (tx) =>
    rowsOf(
      await tx.query(
        `select slug, id::text as id from tenants where slug in (${lit(TENANT_A_SLUG)}, ${lit(TENANT_B_SLUG)})`,
      ),
    ),
  );
  const bySlug = new Map(ids.map((row) => [String(row['slug']), String(row['id'])]));
  const tenantA = bySlug.get(TENANT_A_SLUG) ?? '';
  const tenantB = bySlug.get(TENANT_B_SLUG) ?? '';
  if (tenantA === '' || tenantB === '') {
    throw new Error(`seeded tenants are not readable by slug — saw [${[...bySlug.keys()].join(', ')}]`);
  }

  const probeRowA = uuid();
  const probeRowB = uuid();
  await runAsSystem('test:db seed probe rows').run(async (tx) => {
    for (const [tenantId, rowId, slug] of [
      [tenantA, probeRowA, TENANT_A_SLUG],
      [tenantB, probeRowB, TENANT_B_SLUG],
    ] as const) {
      await tx.query(
        `insert into seam_probe_rows (id, tenant_id, label)
         values (${lit(rowId)}, ${lit(tenantId)}, ${lit(`probe of ${slug}`)})`,
      );
      await tx.query(
        `insert into seam_probe_ledger (id, tenant_id, row_id, note)
         values (${lit(uuid())}, ${lit(tenantId)}, ${lit(rowId)}, ${lit(`ledger of ${slug}`)})`,
      );
    }
  });

  return { tenantA, tenantB, probeRowA, probeRowB };
}

/* ------------------------------------------------------------- discovery */

interface TenantTable {
  readonly schema: string;
  readonly name: string;
  readonly qualified: string;
}

/**
 * Every table carrying a `tenant_id` column, read from the catalog. The `drizzle`
 * schema (the migration ledger) and the system schemas are not application
 * tables, so they are not part of the population.
 */
async function discover(client: pg.Client): Promise<TenantTable[]> {
  const result = await client.query(`
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
     and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
    where c.relkind = 'r'
      and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
      and n.nspname not like 'pg_%'
    order by n.nspname, c.relname
  `);
  return rowsOf(result).map((row) => {
    const schema = String(row['schema_name']);
    const name = String(row['table_name']);
    return { schema, name, qualified: `"${schema}"."${name}"` };
  });
}

/** Whether RLS is enabled *and* forced on a table — the coverage fact itself. */
async function rlsCoverage(
  client: pg.Client,
  table: TenantTable,
): Promise<{ enabled: boolean; forced: boolean }> {
  const rows = rowsOf(
    await client.query(
      `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${lit(table.schema)} and c.relname = ${lit(table.name)}`,
    ),
  );
  return { enabled: scalar(rows, 'enabled') === true, forced: scalar(rows, 'forced') === true };
}

/* ----------------------------------------------------------------- the lane */

const fixtures = await seed();
const catalog = await connectAs('vextrus_app');
const tables = await discover(catalog);

// The population is the evidence: a reader of the transcript can see that the
// lane found its subjects rather than being handed them.
process.stdout.write(
  `V-DB discovered ${String(tables.length)} tenant-scoped table(s): ${tables.map((t) => t.name).join(', ')}\n`,
);

test('the discovered population is not empty and holds the permanent probes', () => {
  expect(tables.length).toBeGreaterThan(0);
  const names = tables.map((table) => table.name);
  expect(names).toContain('seam_probe_rows');
  expect(names).toContain('seam_probe_ledger');
});

for (const table of tables) {
  describe(`${table.name}`, () => {
    test(`${table.name} — scoped-read: a tenant sees its own rows and no others`, async () => {
      await forTenant({ tenantId: fixtures.tenantA }).run((tx) =>
        tx.query(`insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantA)})`),
      );

      const mine = await forTenant({ tenantId: fixtures.tenantA }).run(async (tx) =>
        rowsOf(await tx.query(`select count(*)::int as count from ${table.qualified}`)),
      );
      expect(count(mine), `${table.name}: the writing tenant must read its own rows back`).toBeGreaterThan(0);

      const foreign = await forTenant({ tenantId: fixtures.tenantA }).run(async (tx) =>
        rowsOf(
          await tx.query(
            `select count(*)::int as count from ${table.qualified} where tenant_id <> ${lit(fixtures.tenantA)}`,
          ),
        ),
      );
      expect(count(foreign), `${table.name}: forTenant(A) must see no other tenant's rows`).toBe(0);

      const otherSide = await forTenant({ tenantId: fixtures.tenantB }).run(async (tx) =>
        rowsOf(
          await tx.query(
            `select count(*)::int as count from ${table.qualified} where tenant_id = ${lit(fixtures.tenantA)}`,
          ),
        ),
      );
      expect(count(otherSide), `${table.name}: forTenant(B) must not see A's rows`).toBe(0);
    });

    test(`${table.name} — rls-refusal: an unscoped connection reads nothing and writes nothing`, async () => {
      const unscoped = await connectAs('vextrus_app');
      const read = rowsOf(await unscoped.query(`select count(*)::int as count from ${table.qualified}`));
      expect(count(read), `${table.name}: an unscoped connection must read zero rows`).toBe(0);

      const attempt = await refusal(() =>
        unscoped.query(`insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantA)})`),
      );
      expect(attempt.refused, `${table.name}: an unscoped insert must be refused`).toBe(true);
      expect(
        attempt.code,
        `${table.name}: the refusal must be the policy, not a shape complaint — ${attempt.message}`,
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });

    test(`${table.name} — cross-tenant-write-refusal: WITH CHECK refuses a row of another tenant`, async () => {
      const inserted = await refusal(() =>
        forTenant({ tenantId: fixtures.tenantA }).run((tx) =>
          tx.query(`insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantB)})`),
        ),
      );
      expect(inserted.refused, `${table.name}: a cross-tenant insert must be refused`).toBe(true);
      expect(inserted.code, `${table.name}: ${inserted.message}`).toBe(INSUFFICIENT_PRIVILEGE);
    });

    test(`${table.name} — rls-coverage: row level security is enabled AND forced`, async () => {
      const coverage = await rlsCoverage(catalog, table);
      expect(coverage.enabled, `${table.name}: RLS must be enabled`).toBe(true);
      expect(coverage.forced, `${table.name}: RLS must be FORCED — the owner is subject too`).toBe(true);
    });

    const appendOnly = APPEND_ONLY_TABLES.includes(table.name);

    test(`${table.name} — append-only-grants: ${appendOnly ? 'appends only' : 'not declared append-only'}`, async () => {
      const privilege = async (verb: string): Promise<boolean> =>
        scalar(
          rowsOf(
            await catalog.query(
              `select has_table_privilege(${lit('vextrus_app')}, ${lit(table.qualified)}, ${lit(verb)}) as granted`,
            ),
          ),
          'granted',
        ) === true;

      if (!appendOnly) {
        // The fact is "append-only where declared": a table that does not declare
        // it must still be writable through the seam, or the lane would pass by
        // locking everything down.
        expect(await privilege('INSERT'), `${table.name}: the app role must be able to append`).toBe(true);
        return;
      }

      expect(await privilege('INSERT'), `${table.name}: an append-only table still takes appends`).toBe(true);
      expect(await privilege('UPDATE'), `${table.name}: the app role must not hold UPDATE`).toBe(false);
      expect(await privilege('DELETE'), `${table.name}: the app role must not hold DELETE`).toBe(false);

      const appended = await refusal(() =>
        forTenant({ tenantId: fixtures.tenantA }).run((tx) =>
          tx.query(`insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantA)})`),
        ),
      );
      expect(appended.refused, `${table.name}: an append must succeed — ${appended.message}`).toBe(false);

      for (const statement of [
        `update ${table.qualified} set tenant_id = tenant_id where tenant_id = ${lit(fixtures.tenantA)}`,
        `delete from ${table.qualified} where tenant_id = ${lit(fixtures.tenantA)}`,
      ]) {
        const attempt = await refusal(() =>
          forTenant({ tenantId: fixtures.tenantA }).run((tx) => tx.query(statement)),
        );
        expect(attempt.refused, `${table.name}: "${statement.slice(0, 20)}…" must be refused`).toBe(true);
        expect(attempt.code, `${table.name}: ${attempt.message}`).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });
  });
}

describe('the lane', () => {
  test('rls-coverage is a check that can fail: the held-out rls_gap table', async () => {
    const owner = await connectAs('vextrus_migrate');
    await owner.query('drop table if exists rls_gap');
    await owner.query(
      'create table rls_gap (id uuid not null default gen_random_uuid(), tenant_id uuid not null, primary key (tenant_id, id))',
    );
    try {
      const gap: TenantTable = { schema: 'public', name: 'rls_gap', qualified: '"public"."rls_gap"' };
      const found = await discover(catalog);
      expect(
        found.map((table) => table.name),
        'a tenant-scoped table is discovered whether or not it is protected',
      ).toContain('rls_gap');

      const coverage = await rlsCoverage(catalog, gap);
      expect(coverage.enabled, 'the held-out probe must fail the coverage check').toBe(false);
      expect(coverage.forced, 'the held-out probe must fail the coverage check').toBe(false);
    } finally {
      await owner.query('drop table if exists rls_gap');
    }
  });

  test('composite-fk-backstop: a ledger line cannot point at another tenant’s row', async () => {
    const crossTenant = await refusal(() =>
      forTenant({ tenantId: fixtures.tenantA }).run((tx) =>
        tx.query(
          `insert into seam_probe_ledger (id, tenant_id, row_id, note)
           values (${lit(uuid())}, ${lit(fixtures.tenantA)}, ${lit(fixtures.probeRowB)}, ${lit('stolen')})`,
        ),
      ),
    );
    expect(crossTenant.refused, 'the composite FK must refuse a row belonging to another tenant').toBe(true);
    expect(crossTenant.code, crossTenant.message).toBe(FOREIGN_KEY_VIOLATION);

    // And the backstop is the database's, not the seam's: the system escape
    // widens what may be read, never what may be made inconsistent.
    const asSystem = await refusal(() =>
      runAsSystem('test:db composite fk backstop').run((tx) =>
        tx.query(
          `insert into seam_probe_ledger (id, tenant_id, row_id, note)
           values (${lit(uuid())}, ${lit(fixtures.tenantA)}, ${lit(fixtures.probeRowB)}, ${lit('stolen')})`,
        ),
      ),
    );
    expect(asSystem.refused, 'runAsSystem must not be able to break the composite FK').toBe(true);
    expect(asSystem.code, asSystem.message).toBe(FOREIGN_KEY_VIOLATION);
  });

  test('role-split: three roles, none privileged, and only one owns anything', async () => {
    const roles = rowsOf(
      await catalog.query(
        `select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles
         where rolname in (${ROLES.map((role) => lit(role)).join(', ')})`,
      ),
    );
    expect(roles.length, 'all three roles must exist').toBe(ROLES.length);
    for (const row of roles) {
      expect(row['rolsuper'], `${String(row['rolname'])} must not be superuser`).toBe(false);
      expect(row['rolbypassrls'], `${String(row['rolname'])} must not bypass RLS`).toBe(false);
      expect(row['rolcanlogin'], `${String(row['rolname'])} must be able to log in`).toBe(true);
    }

    // Proved by connecting as each role, not by reading a catalog about them.
    for (const role of ROLES) {
      const client = await connectAs(role);
      const who = scalar(rowsOf(await client.query('select current_user as who')), 'who');
      expect(who, 'the dev password contract must actually authenticate').toBe(role);
    }

    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const client = await connectAs(role);
      const attempt = await refusal(() => client.query('create table role_split_probe (id int)'));
      expect(attempt.refused, `${role} must not be able to CREATE TABLE`).toBe(true);
    }

    const owners = rowsOf(
      await catalog.query(
        `select tablename, tableowner from pg_tables
         where schemaname not in ('pg_catalog', 'information_schema', 'drizzle')
           and schemaname not like 'pg_%'`,
      ),
    );
    expect(owners.length, 'the migration must have created application tables').toBeGreaterThan(0);
    for (const row of owners) {
      expect(row['tableowner'], `${String(row['tablename'])} must be owned by the migrate role`).toBe(
        'vextrus_migrate',
      );
    }
  });

  test('migration-ledger: recorded, and out of the runtime roles’ reach', async () => {
    const owner = await connectAs('vextrus_migrate');
    const recorded = count(
      rowsOf(await owner.query('select count(*)::int as count from drizzle.__drizzle_migrations')),
    );
    expect(recorded, 'every applied migration is recorded in the ledger').toBeGreaterThan(0);

    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const client = await connectAs(role);
      const read = await refusal(() => client.query('select * from drizzle.__drizzle_migrations'));
      expect(read.refused, `${role} must not be able to read the ledger`).toBe(true);
      expect(read.code, read.message).toBe(INSUFFICIENT_PRIVILEGE);

      const write = await refusal(() =>
        client.query("insert into drizzle.__drizzle_migrations (hash) values ('forged')"),
      );
      expect(write.refused, `${role} must not be able to write the ledger`).toBe(true);
      expect(write.code, write.message).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  test('the seam refuses a handle with no scope', async () => {
    for (const bad of ['', '   ']) {
      const attempt = await refusal(async () => forTenant({ tenantId: bad }).run(async () => undefined));
      expect(attempt.refused, `forTenant(${JSON.stringify(bad)}) must refuse`).toBe(true);
      expect(attempt.message).toContain('TENANT_REQUIRED');
    }
    const unexplained = await refusal(async () => runAsSystem('  ').run(async () => undefined));
    expect(unexplained.refused, 'runAsSystem must refuse an empty reason').toBe(true);
    expect(unexplained.message).toContain('SYSTEM_REASON_REQUIRED');
  });

  test('the tenant setting is transaction-local, never left on the pooled connection', async () => {
    await forTenant({ tenantId: fixtures.tenantA }).run((tx) => tx.query('select 1 as ok'));
    const leaked = await runAsSystem('test:db leak check').run(async (tx) =>
      rowsOf(await tx.query(`select coalesce(current_setting('app.tenant_id', true), '') as tenant`)),
    );
    expect(String(scalar(leaked, 'tenant') ?? ''), 'the scope must die with its transaction').toBe('');
  });
});
