/**
 * V-DB — the live seam lane.
 *
 * The population under test is read out of the catalog, never written down
 * here: every table carrying a `tenant_id` column, outside the migration ledger
 * (`drizzle`) and the system schemas. That is the whole design. A later
 * increment adds a table and this file does not change; the four seam facts are
 * proven about the new table the first time the lane runs, and a table that
 * arrives without forced RLS fails `rls-coverage` by construction rather than by
 * somebody remembering to add it to a list.
 *
 * Facts proven here, by name: scoped-read, rls-refusal,
 * cross-tenant-write-refusal, append-only-grants, rls-coverage,
 * composite-fk-backstop, role-split, migration-ledger.
 *
 * The raw `pg` connections below are the point of the exercise: half of these
 * facts are about what happens *outside* `src/core/db.ts`, and a test that could
 * only reach the database through the seam could not prove the seam is the only
 * way in.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { APPEND_ONLY_TABLES } from '../schema';
import { forTenant, runAsSystem } from '../../src/core/db';

/* --------------------------------------------------------------- plumbing */

const envOr = (name: string, fallback: string): string => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

const BOOTSTRAP = envOr('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');
const DATABASE = envOr('VDB_PG_DATABASE', 'vextrus_dev');

const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'] as const;
type RoleName = (typeof ROLES)[number];

/** Dev passwords equal the role names, so a role URL is derived, not configured. */
const roleUrl = (role: RoleName): string => {
  const url = new URL(BOOTSTRAP);
  url.username = role;
  url.password = role;
  url.pathname = `/${DATABASE}`;
  return url.toString();
};

const superuserUrl = (): string => {
  const url = new URL(BOOTSTRAP);
  url.pathname = `/${DATABASE}`;
  return url.toString();
};

interface Row {
  readonly [column: string]: unknown;
}

async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function asRole<T>(role: RoleName, work: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect(roleUrl(role));
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const rowsOf = async (client: Client, sql: string): Promise<Row[]> =>
  (await client.query(sql)).rows as Row[];

const countOf = (rows: Row[]): number => Number(rows[0]?.['count'] ?? 0);

/** A single-quoted SQL literal. Every value inlined here is minted by this file. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const uuid = (): string => crypto.randomUUID();

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
    const bag = error as { code?: unknown; message?: unknown };
    return {
      refused: true,
      code: typeof bag.code === 'string' ? bag.code : '',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 42501 covers both a policy refusal and a missing grant — the database saying no. */
const INSUFFICIENT_PRIVILEGE = '42501';
const FOREIGN_KEY_VIOLATION = '23503';

const isRlsRefusal = (r: Refusal): boolean =>
  r.refused && (r.code === INSUFFICIENT_PRIVILEGE || /row-level security|policy/i.test(r.message));

/* --------------------------------------------------------------- discovery */

interface TenantTable {
  readonly schema: string;
  readonly name: string;
  readonly qualified: string;
}

/**
 * The population, from `pg_class`/`pg_attribute`. `drizzle` is excluded because
 * the migration ledger is the lane's own bookkeeping, not application data, and
 * the `pg_*` schemas because they are the server's.
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

async function discover(client: Client): Promise<TenantTable[]> {
  return (await rowsOf(client, DISCOVERY)).map((row) => {
    const schema = String(row['schema_name']);
    const name = String(row['table_name']);
    return { schema, name, qualified: `"${schema}"."${name}"` };
  });
}

/**
 * Discovery happens at collection time so the lane can name one describe block
 * per discovered table: a table proven and a table never seen must not read the
 * same in the transcript.
 */
const catalog = await connect(superuserUrl());
const TABLES = await discover(catalog);
await catalog.end();

/* ---------------------------------------------------------------- fixtures */

const TENANT_A_SLUG = 'tenant-a';
const TENANT_B_SLUG = 'tenant-b';

let tenantA = '';
let tenantB = '';
let probeRowA = '';
let probeRowB = '';
let unscoped: Client;

beforeAll(async () => {
  await runAsSystem('V-DB seed: tenants')(async (tx) => {
    for (const slug of [TENANT_A_SLUG, TENANT_B_SLUG]) {
      await tx.query(
        `insert into tenants (id, slug, name) values (${lit(uuid())}, ${lit(slug)}, ${lit(slug)})
         on conflict (slug) do nothing`,
      );
    }
  });

  const ids = await runAsSystem('V-DB seed: read tenant ids')(async (tx) =>
    (
      await tx.query(
        `select slug, id::text as id from tenants
         where slug in (${lit(TENANT_A_SLUG)}, ${lit(TENANT_B_SLUG)})`,
      )
    ).rows as Row[],
  );
  const bySlug = new Map(ids.map((row) => [String(row['slug']), String(row['id'])]));
  tenantA = bySlug.get(TENANT_A_SLUG) ?? '';
  tenantB = bySlug.get(TENANT_B_SLUG) ?? '';

  probeRowA = uuid();
  probeRowB = uuid();
  await runAsSystem('V-DB seed: probe rows')(async (tx) => {
    for (const [tenantId, rowId] of [
      [tenantA, probeRowA],
      [tenantB, probeRowB],
    ]) {
      await tx.query(
        `insert into seam_probe_rows (id, tenant_id, label)
         values (${lit(String(rowId))}, ${lit(String(tenantId))}, ${lit('V-DB probe')})`,
      );
      await tx.query(
        `insert into seam_probe_ledger (id, tenant_id, row_id, note)
         values (${lit(uuid())}, ${lit(String(tenantId))}, ${lit(String(rowId))}, ${lit('V-DB ledger')})`,
      );
    }
  });

  // One raw, never-scoped app connection: what the database looks like to a
  // caller who went around the seam.
  unscoped = await connect(roleUrl('vextrus_app'));
});

afterAll(async () => {
  await unscoped?.end();
});

/* ------------------------------------------------------------- the lane */

test('the lane has a migrated database to introspect', () => {
  expect(TABLES.length, 'no tenant-scoped table was discovered — is the database migrated?').toBeGreaterThan(0);
  const names = TABLES.map((t) => t.name);
  expect(names).toContain('seam_probe_rows');
  expect(names).toContain('seam_probe_ledger');
});

/** The RLS coverage assertion, as a function, so the held-out table can be judged by it. */
async function assertRlsCoverage(client: Client, table: TenantTable): Promise<void> {
  const rows = await rowsOf(
    client,
    `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = ${lit(table.schema)} and c.relname = ${lit(table.name)}`,
  );
  expect(rows[0]?.['enabled'], `${table.name}: RLS must be enabled`).toBe(true);
  expect(rows[0]?.['forced'], `${table.name}: RLS must be FORCED — the owner is subject too`).toBe(
    true,
  );
  expect(
    Number(rows[0]?.['policies'] ?? 0),
    `${table.name}: a table with RLS and no policy is a table nobody can read`,
  ).toBeGreaterThan(0);
}

for (const table of TABLES) {
  describe(`V-DB ${table.name}`, () => {
    test(`scoped-read: ${table.name} shows a tenant its own rows and no others`, async () => {
      for (const tenantId of [() => tenantA, () => tenantB]) {
        const id = tenantId();
        const mine = await runAsSystem(`V-DB scoped-read baseline ${table.name}`)(async (tx) =>
          countOf(
            (
              await tx.query(
                `select count(*)::int as count from ${table.qualified} where tenant_id = ${lit(id)}`,
              )
            ).rows as Row[],
          ),
        );
        const scoped = await forTenant({ tenantId: id })(async (tx) =>
          countOf((await tx.query(`select count(*)::int as count from ${table.qualified}`)).rows as Row[]),
        );
        expect(scoped, `${table.name}: forTenant must see exactly its tenant's rows`).toBe(mine);

        const foreign = await forTenant({ tenantId: id })(async (tx) =>
          countOf(
            (
              await tx.query(
                `select count(*)::int as count from ${table.qualified} where tenant_id <> ${lit(id)}`,
              )
            ).rows as Row[],
          ),
        );
        expect(foreign, `${table.name}: no other tenant's row may be visible`).toBe(0);
      }
    });

    test(`rls-refusal: ${table.name} is invisible and unwritable without a tenant`, async () => {
      const seen = countOf(
        await rowsOf(unscoped, `select count(*)::int as count from ${table.qualified}`),
      );
      expect(seen, `${table.name}: an unscoped connection must read zero rows`).toBe(0);

      const attempt = await refusal(() =>
        unscoped.query(`insert into ${table.qualified} (tenant_id) values (${lit(tenantA)})`),
      );
      expect(attempt.refused, `${table.name}: an unscoped insert must be refused`).toBe(true);
      expect(
        isRlsRefusal(attempt),
        `${table.name}: the refusal must be the database's, not a shape complaint — got ${attempt.code} ${attempt.message}`,
      ).toBe(true);
    });

    test(`cross-tenant-write-refusal: ${table.name} refuses a write into another tenant`, async () => {
      const attempt = await refusal(() =>
        forTenant({ tenantId: tenantA })((tx) =>
          tx.query(`insert into ${table.qualified} (tenant_id) values (${lit(tenantB)})`),
        ),
      );
      expect(attempt.refused, `${table.name}: WITH CHECK must refuse a cross-tenant insert`).toBe(
        true,
      );
      expect(isRlsRefusal(attempt), `${table.name}: got ${attempt.code} ${attempt.message}`).toBe(
        true,
      );
    });

    test(`append-only-grants: ${table.name} is mutable exactly when it is not declared append-only`, async () => {
      const declared = APPEND_ONLY_TABLES.includes(table.name);
      const rows = await asRole('vextrus_migrate', (client) =>
        rowsOf(
          client,
          `select has_table_privilege('vextrus_app', ${lit(table.qualified)}, 'UPDATE') as upd,
                  has_table_privilege('vextrus_app', ${lit(table.qualified)}, 'DELETE') as del,
                  has_table_privilege('vextrus_app', ${lit(table.qualified)}, 'INSERT') as ins`,
        ),
      );
      expect(rows[0]?.['ins'], `${table.name}: the app role must be able to append`).toBe(true);
      expect(
        rows[0]?.['upd'],
        `${table.name}: UPDATE grant must match its APPEND_ONLY_TABLES declaration`,
      ).toBe(!declared);
      expect(
        rows[0]?.['del'],
        `${table.name}: DELETE grant must match its APPEND_ONLY_TABLES declaration`,
      ).toBe(!declared);
    });

    test(`rls-coverage: ${table.name} has row level security enabled AND forced`, async () => {
      await asRole('vextrus_migrate', (client) => assertRlsCoverage(client, table));
    });
  });
}

describe('V-DB rls-coverage is coverage by construction', () => {
  test('rls-coverage: a tenant_id table without forced RLS fails the very same check', async () => {
    // The held-out table. It never reaches the discovered population — it is
    // created and dropped inside this test — and it exists to prove that the
    // coverage assertion is capable of failing. A guardrail nobody has watched
    // fail is a guardrail nobody has tested (B-05).
    const gap: TenantTable = { schema: 'public', name: 'rls_gap', qualified: '"public"."rls_gap"' };
    await asRole('vextrus_migrate', async (client) => {
      await client.query(
        `create table ${gap.qualified} (id uuid primary key default gen_random_uuid(), tenant_id uuid not null)`,
      );
      try {
        const seen = await refusal(() => assertRlsCoverage(client, gap));
        expect(seen.refused, 'a table with no RLS must fail the coverage check').toBe(true);
        expect(seen.message).toMatch(/RLS must be enabled/);

        // Half a guardrail is not a guardrail: enabled but not forced still fails.
        await client.query(`alter table ${gap.qualified} enable row level security`);
        const halfway = await refusal(() => assertRlsCoverage(client, gap));
        expect(halfway.refused, 'enabled-but-not-forced must fail too').toBe(true);
        expect(halfway.message).toMatch(/FORCED/);
      } finally {
        await client.query(`drop table if exists ${gap.qualified}`);
      }
    });
  });
});

describe('V-DB the seam itself', () => {
  test('append-only-grants: seam_probe_ledger appends through forTenant and refuses rewrites', async () => {
    const appended = await refusal(() =>
      forTenant({ tenantId: tenantA })((tx) =>
        tx.query(
          `insert into seam_probe_ledger (id, tenant_id, row_id, note)
           values (${lit(uuid())}, ${lit(tenantA)}, ${lit(probeRowA)}, ${lit('appended')})`,
        ),
      ),
    );
    expect(appended.refused, `an append must succeed: ${appended.message}`).toBe(false);

    for (const statement of [
      `update seam_probe_ledger set note = ${lit('rewritten')} where tenant_id = ${lit(tenantA)}`,
      `delete from seam_probe_ledger where tenant_id = ${lit(tenantA)}`,
    ]) {
      const attempt = await refusal(() =>
        forTenant({ tenantId: tenantA })((tx) => tx.query(statement)),
      );
      expect(attempt.refused, `append-only: ${statement.slice(0, 24)} must be refused`).toBe(true);
      expect(attempt.code, `append-only is a missing grant: ${attempt.message}`).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }

    // And the owner, who has every privilege by definition, is refused it too.
    // The system scope is set first so the policies are not what refuses this:
    // with the rows in front of it, the trigger is the only thing left saying no.
    const owner = await asRole('vextrus_migrate', async (client) => {
      await client.query(`select set_config('app.system', 'on', false)`);
      return refusal(() => client.query(`update seam_probe_ledger set note = ${lit('owner rewrite')}`));
    });
    expect(owner.refused, 'the append-only trigger must refuse the owner as well').toBe(true);
    expect(owner.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  test('composite-fk-backstop: a ledger row may not point across the tenant boundary, even as system', async () => {
    const good = await refusal(() =>
      runAsSystem('V-DB composite-fk-backstop: same-tenant parent')((tx) =>
        tx.query(
          `insert into seam_probe_ledger (id, tenant_id, row_id, note)
           values (${lit(uuid())}, ${lit(tenantA)}, ${lit(probeRowA)}, ${lit('within tenant')})`,
        ),
      ),
    );
    expect(good.refused, `a same-tenant parent must be accepted: ${good.message}`).toBe(false);

    // (tenantA, probeRowB) is not a row of seam_probe_rows: the composite key is
    // what refuses it, so runAsSystem — which every policy lets through — cannot.
    const crossed = await refusal(() =>
      runAsSystem('V-DB composite-fk-backstop: cross-tenant parent')((tx) =>
        tx.query(
          `insert into seam_probe_ledger (id, tenant_id, row_id, note)
           values (${lit(uuid())}, ${lit(tenantA)}, ${lit(probeRowB)}, ${lit('across tenants')})`,
        ),
      ),
    );
    expect(crossed.refused, 'a cross-tenant parent must be refused even under runAsSystem').toBe(
      true,
    );
    expect(crossed.code, `the refusal must be the foreign key: ${crossed.message}`).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  test('role-split: three roles, none privileged, and only the owner may shape the database', async () => {
    const rows = await asRole('vextrus_migrate', (client) =>
      rowsOf(
        client,
        `select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles
         where rolname in (${ROLES.map(lit).join(', ')})`,
      ),
    );
    expect(rows.length, 'all three roles must exist').toBe(ROLES.length);
    for (const row of rows) {
      expect(row['rolsuper'], `${String(row['rolname'])} must not be superuser`).toBe(false);
      expect(row['rolbypassrls'], `${String(row['rolname'])} must not bypass RLS`).toBe(false);
      expect(row['rolcanlogin'], `${String(row['rolname'])} must be able to log in`).toBe(true);
    }

    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const who = await asRole(role, async (client) =>
        String((await rowsOf(client, 'select current_user as who'))[0]?.['who'] ?? ''),
      );
      expect(who, 'the dev password contract is only real if it authenticates').toBe(role);

      const attempt = await asRole(role, (client) =>
        refusal(() => client.query(`create table role_split_probe_${Date.now()} (id int)`)),
      );
      expect(attempt.refused, `${role} must not be able to CREATE TABLE`).toBe(true);
    }

    const owners = await asRole('vextrus_migrate', (client) =>
      rowsOf(
        client,
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

    // Both seam handles are the app role and nothing else.
    for (const handle of [
      forTenant({ tenantId: tenantA }),
      runAsSystem('V-DB role-split: which role is the seam'),
    ]) {
      const who = await handle(async (tx) =>
        String(((await tx.query('select current_user as who')).rows as Row[])[0]?.['who'] ?? ''),
      );
      expect(who).toBe('vextrus_app');
    }
  });

  test('migration-ledger: recorded, owned by migrate, and out of the app role`s reach', async () => {
    const recorded = await asRole('vextrus_migrate', (client) =>
      rowsOf(client, 'select count(*)::int as count from drizzle.__drizzle_migrations'),
    );
    expect(countOf(recorded), 'the initial migration must be recorded').toBeGreaterThan(0);

    for (const statement of [
      'select count(*) from drizzle.__drizzle_migrations',
      "insert into drizzle.__drizzle_migrations (hash, created_at) values ('forged', 0)",
      'delete from drizzle.__drizzle_migrations',
    ]) {
      const attempt = await refusal(() => unscoped.query(statement));
      expect(attempt.refused, `the app role must not reach the ledger: ${statement}`).toBe(true);
      expect(attempt.code, `${statement}: ${attempt.message}`).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  test('the tenant setting is transaction-local, so it cannot ride the pool', async () => {
    await forTenant({ tenantId: tenantA })((tx) => tx.query('select 1 as ok'));
    const leaked = await runAsSystem('V-DB leak check')(async (tx) =>
      String(
        ((await tx.query(`select coalesce(current_setting('app.tenant_id', true), '') as tenant`))
          .rows as Row[])[0]?.['tenant'] ?? '',
      ),
    );
    expect(leaked, 'a set_config without the transaction-local flag rides the connection').toBe('');
  });
});
