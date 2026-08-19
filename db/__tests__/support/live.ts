/**
 * The live lane's plumbing: connections as each role, catalog introspection, and
 * the synthetic INSERT the per-table facts are probed with.
 *
 * Nothing here asserts. The point of the V-DB suite is that it *discovers* what
 * to prove — a later increment adds a table and the suite covers it with no edit
 * — so everything table-specific has to be derived from the migrated catalog
 * rather than written down.
 */
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
}

/**
 * Every table that carries a `tenant_id` column, straight out of the catalog.
 *
 * This is the discovery R-SPINE-004 is proven with: the population is "whatever
 * is tenant-scoped in the migrated database", so a table that arrives in a later
 * increment is covered the moment it is migrated, and a table that quietly drops
 * its RLS is caught by the same run. `drizzle` is excluded because the migration
 * ledger is infrastructure, not tenant data.
 */
export async function discoverTenantTables(): Promise<TenantTable[]> {
  const found = await asRole(
    'vextrus_migrate',
    `select n.nspname as schema_name, c.relname as table_name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
      where c.relkind = 'r'
        and a.attname = 'tenant_id'
        and a.attnum > 0
        and not a.attisdropped
        and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
        and n.nspname not like 'pg\\_%'
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
    return { schema, name, qualified: `${schema}.${name}` };
  });
}

/**
 * A literal that satisfies a column's type, so an INSERT probe is refused by the
 * policy rather than by a NOT NULL constraint: Postgres checks not-null and CHECK
 * before the RLS `WITH CHECK`, so a probe built out of nulls would prove nothing
 * about row level security. Undefined for a type this helper cannot synthesise.
 */
function literalFor(udtName: string, column: string, tenantId: string): string | undefined {
  if (column === 'tenant_id') return `'${tenantId}'::uuid`;
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
 * default and forbids null, plus `tenant_id` whatever its default. Undefined when
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
    if (!required && column !== 'tenant_id') continue;
    const literal = literalFor(String(row['udt_name']), column, tenantId);
    if (literal === undefined) return undefined;
    names.push(column);
    values.push(literal);
  }
  if (!names.includes('tenant_id')) return undefined;
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
