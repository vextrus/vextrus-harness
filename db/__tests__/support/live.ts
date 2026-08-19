/**
 * The live lane's plumbing: connections as each role, catalog introspection, and
 * the synthetic INSERT the per-table facts are probed with.
 *
 * Nothing here asserts. The point of the V-DB suite is that it *discovers* what
 * to prove — a later increment adds a table and the suite covers it with no edit
 * — so everything table-specific has to be derived from the migrated catalog
 * rather than written down.
 */
import { createHash } from 'node:crypto';

import pg from 'pg';

const { Client } = pg;

export type Row = Record<string, unknown>;

/** An exported-but-empty override falls back to the default (the CHECKUP_PG_PORT convention). */
const env = (name: string, fallback: string): string => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

export const BOOTSTRAP_URL = (): string =>
  env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');
export const DATABASE = (): string => env('VDB_PG_DATABASE', 'vextrus_dev');

export const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'] as const;
export type Role = (typeof ROLES)[number];

/** The migrated database reached as `role`, whose dev password is its own name. */
export function urlForRole(role: Role): string {
  const url = new URL(BOOTSTRAP_URL());
  url.username = role;
  url.password = role;
  url.pathname = `/${DATABASE()}`;
  return url.toString();
}

export interface RawResult {
  readonly rows: Row[];
  readonly error?: string;
}

/**
 * One statement on its own fresh connection as `role`. An error comes back as a
 * value: a refusal is the result these tests are looking for most of the time,
 * and a thrown exception would make "the database said no" indistinguishable
 * from "the test is broken".
 *
 * Fresh, not pooled, because half of what this suite proves is what a connection
 * *without* the seam's settings can do — a reused connection could carry a
 * setting from the last caller, which is the leak AC-08 exists to catch.
 */
export async function asRole(
  role: Role,
  text: string,
  params: readonly unknown[] = [],
): Promise<RawResult> {
  const client = new Client({ connectionString: urlForRole(role) });
  try {
    await client.connect();
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
  try {
    const result = await client.query(text, [...params]);
    return { rows: result.rows as Row[] };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface TenantTable {
  readonly schema: string;
  readonly name: string;
  /** `public.seam_probe_rows` — what every message and every statement uses. */
  readonly qualified: string;
  /**
   * The column the table's tenancy is keyed on: `tenant_id` for an ordinary
   * table, `id` for the tenant registry itself. Discovered, not written down —
   * a table whose policy keys on some other column is covered the same way.
   */
  readonly scope: string;
}

/**
 * Every tenant-scoped table, straight out of the catalog: one that carries a
 * `tenant_id` column, or one whose policy keys on `app.tenant_id` through some
 * other column — `tenants` itself is scoped on `id`, and a registry nobody
 * probes is the one table whose leak enumerates every customer.
 *
 * This is the discovery R-SPINE-004 is proven with: the population is "whatever
 * is tenant-scoped in the migrated database", so a table that arrives in a later
 * increment is covered the moment it is migrated, and a table that quietly drops
 * its RLS is caught by the same run. `drizzle` is excluded because the migration
 * ledger is infrastructure, not tenant data.
 *
 * Ordinary tables (`relkind = 'r'`) and partitioned ones (`'p'`) alike: a
 * partitioned table is the relation queries name and the one whose policies
 * apply to the rows routed through it, so a population that skipped it would
 * leave the largest tables this project will have outside every seam fact.
 */
export async function discoverTenantTables(): Promise<TenantTable[]> {
  const found = await asRole(
    'vextrus_migrate',
    `with candidate as (
       select n.nspname as schema_name, c.relname as table_name, c.oid as oid
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p')
          and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
          and n.nspname not like 'pg\\_%'
     ), scoped as (
       select schema_name,
              table_name,
              coalesce(
                (select a.attname
                   from pg_attribute a
                  where a.attrelid = candidate.oid
                    and a.attname = 'tenant_id'
                    and a.attnum > 0
                    and not a.attisdropped),
                (select substring(
                          pg_get_expr(p.polqual, p.polrelid)
                          from '([a-z_][a-z0-9_]*) = \\(?NULLIF\\(current_setting\\(''app\\.tenant_id''')
                   from pg_policy p
                  where p.polrelid = candidate.oid
                    and pg_get_expr(p.polqual, p.polrelid) like '%app.tenant_id%'
                  order by p.polname
                  limit 1)
              ) as scope_column
         from candidate
     )
     select schema_name, table_name, scope_column
       from scoped
      where scope_column is not null
      order by 1, 2`,
  );
  if (found.error !== undefined) {
    throw new Error(
      `discovery failed: ${found.error} — has \`pnpm db:migrate\` been run against ${DATABASE()}?`,
    );
  }
  return found.rows.map((row) => {
    const schema = String(row['schema_name']);
    const name = String(row['table_name']);
    return { schema, name, qualified: `${schema}.${name}`, scope: String(row['scope_column']) };
  });
}

/**
 * A uuid that is the same on every run, so a fixture seeded with
 * `on conflict do nothing` is seeded once rather than once per run.
 *
 * The probe tables are permanent and the dev Postgres is a persistent native
 * install — a fresh random id per run would pile rows into `seam_probe_rows`
 * and (which cannot even be deleted) `seam_probe_ledger` for the life of the
 * project, and the scoped-read fact reads every row of every discovered table.
 * The 30 s budget (AC-02) should not be something the calendar spends.
 */
export function stableUuid(seed: string): string {
  const hex = createHash('sha1').update(`vextrus V-DB fixture ${seed}`).digest('hex').slice(0, 32);
  // Version 5, variant 10xx: a name-based uuid, so it is a legal one whatever
  // the column's type check is.
  const version = `5${hex.slice(13, 16)}`;
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A literal that satisfies a column's type, so an INSERT probe is refused by the
 * policy rather than by a NOT NULL constraint: Postgres checks not-null and CHECK
 * before the RLS `WITH CHECK`, so a probe built out of nulls would prove nothing
 * about row level security. Undefined for a type this helper cannot synthesise.
 */
function literalFor(
  udtName: string,
  column: string,
  scope: string,
  tenantId: string,
): string | undefined {
  if (column === scope) return `'${tenantId}'::uuid`;
  switch (udtName) {
    case 'uuid':
      return `'${crypto.randomUUID()}'::uuid`;
    case 'text':
    case 'varchar':
    case 'bpchar':
    case 'name':
      return `'seam probe'`;
    case 'int2':
    case 'int4':
    case 'int8':
    case 'numeric':
    case 'float4':
    case 'float8':
      return '0';
    case 'bool':
      return 'false';
    case 'date':
    case 'timestamp':
    case 'timestamptz':
      return 'now()';
    case 'json':
    case 'jsonb':
      return `'{}'::${udtName}`;
    default:
      return undefined;
  }
}

/**
 * A complete INSERT for `table` owned by `tenantId`: every column that has no
 * default and forbids null, plus the scope column whatever its default. Undefined when
 * a column's type is outside `literalFor`'s vocabulary — the caller counts how
 * many tables it could probe rather than assuming it probed them all.
 */
export async function syntheticInsert(
  table: TenantTable,
  tenantId: string,
): Promise<string | undefined> {
  const columns = await asRole(
    'vextrus_migrate',
    `select column_name, udt_name, is_nullable, column_default
       from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [table.schema, table.name],
  );
  if (columns.error !== undefined) throw new Error(`introspection failed: ${columns.error}`);

  const names: string[] = [];
  const values: string[] = [];
  for (const row of columns.rows) {
    const column = String(row['column_name']);
    const required = row['is_nullable'] === 'NO' && row['column_default'] === null;
    if (!required && column !== table.scope) continue;
    const literal = literalFor(String(row['udt_name']), column, table.scope, tenantId);
    if (literal === undefined) return undefined;
    names.push(column);
    values.push(literal);
  }
  if (!names.includes(table.scope)) return undefined;
  return `insert into ${table.qualified} (${names.join(', ')}) values (${values.join(', ')})`;
}

/** Whether the app role holds `privilege` on a table, as the catalog sees it. */
export async function appHasPrivilege(
  table: TenantTable,
  privilege: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
): Promise<boolean> {
  const answer = await asRole(
    'vextrus_migrate',
    `select has_table_privilege('vextrus_app', $1, $2) as granted`,
    [table.qualified, privilege],
  );
  if (answer.error !== undefined) throw new Error(`privilege lookup failed: ${answer.error}`);
  return answer.rows[0]?.['granted'] === true;
}

/**
 * Row level security as the catalog reports it: enabled, *forced* (so the owner
 * is subject to it too), and carrying at least one policy. All three, because
 * each one alone can be true while the table is wide open.
 */
export interface RlsState {
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly policies: number;
}

export async function rlsState(table: TenantTable): Promise<RlsState> {
  const answer = await asRole(
    'vextrus_migrate',
    `select c.relrowsecurity as enabled,
            c.relforcerowsecurity as forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relname = $2`,
    [table.schema, table.name],
  );
  if (answer.error !== undefined) throw new Error(`rls lookup failed: ${answer.error}`);
  const row = answer.rows[0];
  return {
    enabled: row?.['enabled'] === true,
    forced: row?.['forced'] === true,
    policies: Number(row?.['policies'] ?? 0),
  };
}

/** The message of a rejected promise, as a string a matcher can be run against. */
export async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}
