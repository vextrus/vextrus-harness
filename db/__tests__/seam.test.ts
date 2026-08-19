/**
 * V-DB — the live seam suite.
 *
 * The population is discovered, never listed. Every table in the migrated
 * database that carries a `tenant_id` column (outside the migration ledger and
 * the system schemas) gets the same five facts proved about it, so a table that
 * arrives in a later increment is covered the moment it is migrated and a table
 * that arrives *without* RLS fails this lane by construction — no edit here.
 *
 * The facts, named the way the test contract names them:
 *
 *   scoped-read                 a tenant sees its own rows and only those
 *   rls-refusal                 an unscoped app connection reads nothing, writes nothing
 *   cross-tenant-write-refusal  WITH CHECK stops a write aimed at another tenant
 *   append-only-grants          the verbs the app role holds match what the schema declares
 *   rls-coverage                RLS is enabled *and* forced
 *   composite-fk-backstop       the tenant FK still holds where the policies stand aside
 *   role-split                  migrate owns, app and auth cannot create
 *   migration-ledger            the history is not writable by the runtime
 *
 * Discovery happens at collection time, so the per-table facts are real tests
 * with the table in their name rather than a loop hiding inside one.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { APPEND_ONLY_TABLES } from '../schema/index';
import { forTenant, runAsSystem } from '../../src/core/db';

/* ------------------------------------------------------------------- setup */

const trimmedEnv = (name: string, fallback: string): string => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

const BOOTSTRAP = trimmedEnv('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');
const DATABASE = trimmedEnv('VDB_PG_DATABASE', 'vextrus_dev');

const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'] as const;
type RoleName = (typeof ROLES)[number];

/** SQLSTATE 42501 — a missing grant and a policy refusal share it. */
const INSUFFICIENT_PRIVILEGE = '42501';
/** SQLSTATE 23503 — the foreign key backstop. */
const FOREIGN_KEY_VIOLATION = '23503';

const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const uuid = (): string => crypto.randomUUID();

function urlFor(user: string, database: string): string {
  const url = new URL(BOOTSTRAP);
  url.username = user;
  url.password = user;
  url.pathname = `/${database}`;
  return url.toString();
}

async function open(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

const openBootstrap = (): Promise<pg.Client> => {
  const url = new URL(BOOTSTRAP);
  url.pathname = `/${DATABASE}`;
  return open(url.toString());
};

const openRole = (role: RoleName): Promise<pg.Client> => open(urlFor(role, DATABASE));

/** Runs `work` against a role connection and always closes it. */
async function asRole<T>(role: RoleName, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await openRole(role);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

interface Refusal {
  readonly refused: boolean;
  readonly code: string;
  readonly message: string;
}

async function refusal(attempt: () => Promise<unknown>): Promise<Refusal> {
  try {
    await attempt();
    return { refused: false, code: '', message: '' };
  } catch (error) {
    const holder: Record<string, unknown> =
      typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
    return {
      refused: true,
      code: typeof holder['code'] === 'string' ? holder['code'] : '',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const isRlsRefusal = (r: Refusal): boolean =>
  r.refused && (r.code === INSUFFICIENT_PRIVILEGE || /row-level security|policy/i.test(r.message));

const countOf = (rows: Record<string, unknown>[]): number => Number(rows[0]?.['count'] ?? 0);

/* --------------------------------------------------------------- discovery */

interface TenantTable {
  readonly schema: string;
  readonly name: string;
  readonly qualified: string;
}

/**
 * The population, from the catalogue. `pg_attribute` is the source of truth for
 * "carries a tenant_id"; the `drizzle` ledger schema and the system schemas are
 * out of scope by name, and nothing else is.
 */
const DISCOVERY = `
  select n.nspname as schema_name, c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
   and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
  where c.relkind = 'r'
    and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
    and n.nspname not like 'pg_%'
  order by n.nspname, c.relname
`;

async function discover(client: pg.Client): Promise<TenantTable[]> {
  const { rows } = await client.query(DISCOVERY);
  return rows.map((row: Record<string, unknown>) => {
    const schema = String(row['schema_name']);
    const name = String(row['table_name']);
    return { schema, name, qualified: `"${schema}"."${name}"` };
  });
}

/* ---------------------------------------------------------------- fixtures */

const TENANT_A_SLUG = 'tenant-a';
const TENANT_B_SLUG = 'tenant-b';

interface Fixtures {
  readonly tenantA: string;
  readonly tenantB: string;
  readonly probeRowA: string;
  readonly probeRowB: string;
}

/** Seeded through `runAsSystem` — the only route that may write unscoped. */
async function seed(): Promise<Fixtures> {
  await runAsSystem('V-DB seed: tenants')(async (tx) => {
    for (const slug of [TENANT_A_SLUG, TENANT_B_SLUG]) {
      await tx.query(
        `insert into tenants (id, slug, name) values (${lit(uuid())}, ${lit(slug)}, ${lit(slug)})
         on conflict (slug) do nothing`,
      );
    }
  });

  const rows = await runAsSystem('V-DB seed: read tenant ids')((tx) =>
    tx
      .query(
        `select slug, id::text as id from tenants
         where slug in (${lit(TENANT_A_SLUG)}, ${lit(TENANT_B_SLUG)})`,
      )
      .then((result) => result.rows),
  );
  const bySlug = new Map(rows.map((row) => [String(row['slug']), String(row['id'])]));
  const tenantA = bySlug.get(TENANT_A_SLUG);
  const tenantB = bySlug.get(TENANT_B_SLUG);
  if (tenantA === undefined || tenantB === undefined) {
    throw new Error('seeded tenants are not readable back by slug');
  }

  const probeRowA = uuid();
  const probeRowB = uuid();
  await runAsSystem('V-DB seed: probe rows')(async (tx) => {
    for (const [tenantId, rowId] of [
      [tenantA, probeRowA],
      [tenantB, probeRowB],
    ] as const) {
      await tx.query(
        `insert into seam_probe_rows (id, tenant_id, label)
         values (${lit(rowId)}, ${lit(tenantId)}, ${lit('V-DB probe')})`,
      );
      await tx.query(
        `insert into seam_probe_ledger (id, tenant_id, row_id, note)
         values (${lit(uuid())}, ${lit(tenantId)}, ${lit(rowId)}, ${lit('V-DB ledger')})`,
      );
    }
  });

  return { tenantA, tenantB, probeRowA, probeRowB };
}

/* --------------------------------------------------------- collection time */

const catalogue = await openBootstrap();
const tables = await discover(catalogue);
await catalogue.end();

const fixtures = await seed();

process.stdout.write(
  `V-DB discovered ${String(tables.length)} tenant-scoped table(s): ${tables
    .map((table) => `${table.schema}.${table.name}`)
    .join(', ')}\n`,
);

/** The unscoped runtime connection — never given a tenant, on purpose. */
let unscoped: pg.Client;

beforeAll(async () => {
  unscoped = await openRole('vextrus_app');
});

afterAll(async () => {
  await unscoped.end();
});

test('the discovered population is not empty and includes the permanent probes', () => {
  const names = tables.map((table) => table.name);
  expect(names, 'discovery must find the mutable probe').toContain('seam_probe_rows');
  expect(names, 'discovery must find the append-only probe').toContain('seam_probe_ledger');
});

/* ------------------------------------------------------- the per-table facts */

for (const table of tables) {
  describe(`V-DB ${table.schema}.${table.name}`, () => {
    test(`scoped-read: ${table.name} shows each tenant only its own rows`, async () => {
      for (const [label, tenantId] of [
        ['A', fixtures.tenantA],
        ['B', fixtures.tenantB],
      ] as const) {
        const rows = await forTenant({ tenantId })((tx) =>
          tx
            .query(
              `select count(*)::int as count from ${table.qualified} where tenant_id <> ${lit(tenantId)}`,
            )
            .then((result) => result.rows),
        );
        expect(
          countOf(rows),
          `${table.name}: forTenant(${label}) must see no other tenant's rows`,
        ).toBe(0);
      }
    });

    test(`rls-refusal: ${table.name} shows an unscoped connection nothing and takes no write`, async () => {
      const { rows } = await unscoped.query(
        `select count(*)::int as count from ${table.qualified}`,
      );
      expect(countOf(rows), `${table.name}: an unscoped read must return zero rows`).toBe(0);

      const attempt = await refusal(() =>
        unscoped.query(
          `insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantA)})`,
        ),
      );
      expect(attempt.refused, `${table.name}: an unscoped insert must be refused`).toBe(true);
      expect(
        isRlsRefusal(attempt),
        `${table.name}: the refusal must be row-level security — got ${attempt.code} ${attempt.message}`,
      ).toBe(true);
    });

    test(`cross-tenant-write-refusal: ${table.name} refuses a row aimed at another tenant`, async () => {
      const attempt = await refusal(() =>
        forTenant({ tenantId: fixtures.tenantA })((tx) =>
          tx.query(
            `insert into ${table.qualified} (tenant_id) values (${lit(fixtures.tenantB)})`,
          ),
        ),
      );
      expect(attempt.refused, `${table.name}: a cross-tenant insert must be refused`).toBe(true);
      expect(
        isRlsRefusal(attempt),
        `${table.name}: WITH CHECK must be what refuses it — got ${attempt.code} ${attempt.message}`,
      ).toBe(true);
    });

    test(`append-only-grants: ${table.name} holds exactly the verbs its schema declares`, async () => {
      const { rows } = await unscoped.query(`
        select has_table_privilege('vextrus_app', ${lit(table.qualified)}, 'SELECT') as can_select,
               has_table_privilege('vextrus_app', ${lit(table.qualified)}, 'INSERT') as can_insert,
               has_table_privilege('vextrus_app', ${lit(table.qualified)}, 'UPDATE') as can_update,
               has_table_privilege('vextrus_app', ${lit(table.qualified)}, 'DELETE') as can_delete
      `);
      const grants = rows[0] ?? {};
      expect(grants['can_select'], `${table.name}: the app role must be able to read it`).toBe(true);
      expect(grants['can_insert'], `${table.name}: the app role must be able to write it`).toBe(
        true,
      );

      if (APPEND_ONLY_TABLES.includes(table.name)) {
        expect(grants['can_update'], `${table.name} is append-only: no UPDATE grant`).toBe(false);
        expect(grants['can_delete'], `${table.name} is append-only: no DELETE grant`).toBe(false);
      } else {
        expect(
          grants['can_update'],
          `${table.name} is not declared append-only, so it must be updatable`,
        ).toBe(true);
      }
    });

    test(`rls-coverage: ${table.name} has row level security enabled AND forced`, async () => {
      const { rows } = await unscoped.query(`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = ${lit(table.schema)} and c.relname = ${lit(table.name)}
      `);
      const flags = rows[0] ?? {};
      expect(flags['enabled'], `${table.name}: RLS must be enabled`).toBe(true);
      expect(
        flags['forced'],
        `${table.name}: RLS must be FORCED — otherwise the owner walks past every policy`,
      ).toBe(true);
    });
  });
}

/* ------------------------------------------------------- the lane-wide facts */

describe('V-DB the lane itself', () => {
  /**
   * Coverage by construction, proved rather than asserted: a table with a
   * `tenant_id` and no forced RLS is created, the discovery query is run again,
   * and the same predicate the per-table fact uses is shown to fail on it. The
   * heldout table is dropped whatever happens.
   */
  test('rls-coverage: a tenant_id table without forced RLS fails by construction', async () => {
    await asRole('vextrus_migrate', async (client) => {
      await client.query(
        `create table if not exists "rls_gap" (id uuid default gen_random_uuid(), tenant_id uuid not null)`,
      );
      try {
        const discovered = await discover(client);
        const gap = discovered.find((table) => table.name === 'rls_gap');
        expect(gap, 'the heldout table must be discovered — it carries tenant_id').toBeDefined();

        const { rows } = await client.query(`
          select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'rls_gap'
        `);
        const flags = rows[0] ?? {};
        expect(
          flags['enabled'] === true && flags['forced'] === true,
          'the coverage predicate must reject a table with no forced RLS — otherwise it proves nothing',
        ).toBe(false);
      } finally {
        await client.query('drop table if exists "rls_gap"');
      }
    });
  });

  test('composite-fk-backstop: a ledger line cannot point at another tenant’s row, even under runAsSystem', async () => {
    const attempt = await refusal(() =>
      runAsSystem('V-DB: composite fk backstop')((tx) =>
        tx.query(
          `insert into seam_probe_ledger (id, tenant_id, row_id, note)
           values (${lit(uuid())}, ${lit(fixtures.tenantA)}, ${lit(fixtures.probeRowB)}, ${lit('crossed')})`,
        ),
      ),
    );
    expect(
      attempt.refused,
      'the composite tenant FK must hold where the policies have stepped aside',
    ).toBe(true);
    expect(attempt.code, `expected a foreign key violation, got ${attempt.message}`).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  test('role-split: each role connects as itself, and none is superuser or BYPASSRLS', async () => {
    for (const role of ROLES) {
      const who = await asRole(role, async (client) => {
        const { rows } = await client.query('select current_user as who');
        return String(rows[0]?.['who'] ?? '');
      });
      expect(who, `${role} must authenticate as itself`).toBe(role);
    }

    const { rows } = await unscoped.query(`
      select rolname, rolsuper, rolbypassrls from pg_roles
      where rolname in (${ROLES.map((role) => lit(role)).join(', ')})
    `);
    expect(rows.length, 'all three roles must exist').toBe(ROLES.length);
    for (const row of rows) {
      expect(row['rolsuper'], `${String(row['rolname'])} must not be superuser`).toBe(false);
      expect(row['rolbypassrls'], `${String(row['rolname'])} must not bypass RLS`).toBe(false);
    }
  });

  test('role-split: only vextrus_migrate owns tables, and app and auth cannot create them', async () => {
    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const attempt = await asRole(role, (client) =>
        refusal(() => client.query(`create table "role_split_${role}" (id int)`)),
      );
      expect(attempt.refused, `${role} must not be able to CREATE TABLE`).toBe(true);
    }

    const { rows } = await unscoped.query(`
      select tablename, tableowner from pg_tables
      where schemaname not in ('pg_catalog', 'information_schema', 'drizzle')
        and schemaname not like 'pg_%'
    `);
    expect(rows.length, 'the migration must have created application tables').toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row['tableowner'],
        `${String(row['tablename'])} must be owned by the migrate role`,
      ).toBe('vextrus_migrate');
    }
  });

  test('migration-ledger: recorded by migrate, unreadable and unwritable by app and auth', async () => {
    const recorded = await asRole('vextrus_migrate', async (client) => {
      const { rows } = await client.query(
        'select count(*)::int as count from "drizzle"."__drizzle_migrations"',
      );
      return countOf(rows);
    });
    expect(recorded, 'the initial migration must be in the ledger').toBeGreaterThan(0);

    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      for (const statement of [
        'select count(*) from "drizzle"."__drizzle_migrations"',
        `insert into "drizzle"."__drizzle_migrations" (hash, created_at) values (${lit('forged')}, 0)`,
      ]) {
        const attempt = await asRole(role, (client) => refusal(() => client.query(statement)));
        expect(
          attempt.refused,
          `${role} must not be able to run "${statement.slice(0, 20)}…" against the ledger`,
        ).toBe(true);
        expect(attempt.code, `got ${attempt.message}`).toBe(INSUFFICIENT_PRIVILEGE);
      }
    }
  });
});
