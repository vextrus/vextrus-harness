/**
 * Page objects for the database lane: the URLs, the role connections and the
 * fixture seed the live journey drives. Nothing here asserts — the checkpoints do.
 */
import { createHash } from 'node:crypto';

import pg from 'pg';

const { Client } = pg;

export type Row = Record<string, unknown>;
export interface Session {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
}
export interface Handle {
  run<T>(work: (session: Session) => Promise<T>): Promise<T>;
}

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

/** The migrated database, reached as `role` with the dev password (= the role name). */
export function urlForRole(role: Role, database: string = DATABASE()): string {
  const url = new URL(BOOTSTRAP_URL());
  url.username = role;
  url.password = role;
  url.pathname = `/${database}`;
  return url.toString();
}

export interface RawResult {
  readonly rows: Row[];
  readonly error?: string;
}

/** One statement on its own connection as `role`; an error is a value, not a throw. */
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

/** The bootstrap (superuser) connection — used only to read the role catalog. */
export async function asBootstrap(text: string, params: readonly unknown[] = []): Promise<RawResult> {
  const client = new Client({ connectionString: BOOTSTRAP_URL() });
  try {
    await client.connect();
    const result = await client.query(text, [...params]);
    return { rows: result.rows as Row[] };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface Seam {
  forTenant(ctx: { tenantId: string }): Handle;
  runAsSystem(reason: string): Handle;
}

/** SEAM-TENANT, loaded through its own module path — the only handles a test may use. */
export async function seam(): Promise<Seam> {
  const module: unknown = await import('../../../src/core/db');
  return module as Seam;
}

export const TENANT_SLUGS = ['tenant-a', 'tenant-b'] as const;

export interface Fixture {
  readonly a: string;
  readonly b: string;
  readonly rows: Readonly<Record<string, string>>;
  readonly ledger: Readonly<Record<string, string>>;
}

/**
 * A uuid that is the same on every run, so the fixture is seeded once rather
 * than once per run — see `seedFixture`.
 */
function stableUuid(seed: string): string {
  const hex = createHash('sha1').update(`vextrus V-DB fixture ${seed}`).digest('hex').slice(0, 32);
  const version = `5${hex.slice(13, 16)}`;
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The per-run fixture (test contract): two tenants seeded through `runAsSystem`
 * with uuids minted here and read back by slug, then one probe row and one
 * ledger row per tenant written through `forTenant`.
 */
export async function seedFixture(): Promise<Fixture> {
  const { forTenant, runAsSystem } = await seam();

  const ids = await runAsSystem('seed: seam fixtures').run(async (session) => {
    for (const slug of TENANT_SLUGS) {
      await session.query(
        `insert into tenants (id, slug, name) values ($1, $2, $3) on conflict (slug) do nothing`,
        [crypto.randomUUID(), slug, slug],
      );
    }
    const read = await session.query(`select id, slug from tenants where slug = any($1)`, [
      [...TENANT_SLUGS],
    ]);
    return read.rows;
  });

  const bySlug = (slug: string): string => {
    const found = ids.find((row) => row['slug'] === slug);
    if (found === undefined) throw new Error(`fixture: tenant ${slug} was not seeded`);
    return String(found['id']);
  };

  const rows: Record<string, string> = {};
  const ledger: Record<string, string> = {};
  for (const slug of TENANT_SLUGS) {
    const tenantId = bySlug(slug);
    // Stable ids and `on conflict do nothing`, like the `tenants` insert above:
    // the probe tables are permanent and the dev Postgres is a persistent
    // install, so a fresh uuid per run would grow both tables — the ledger
    // unrecoverably, since nothing may delete from it — every time anyone runs
    // the journey.
    const rowId = stableUuid(`seam_probe_rows ${tenantId}`);
    const ledgerId = stableUuid(`seam_probe_ledger ${tenantId}`);
    await forTenant({ tenantId }).run(async (session) => {
      await session.query(
        `insert into seam_probe_rows (id, tenant_id, label) values ($1, $2, $3)` +
          ` on conflict (tenant_id, id) do nothing`,
        [rowId, tenantId, `probe for ${slug}`],
      );
      await session.query(
        `insert into seam_probe_ledger (id, tenant_id, row_id, note) values ($1, $2, $3, $4)` +
          ` on conflict (tenant_id, id) do nothing`,
        [ledgerId, tenantId, rowId, `ledger for ${slug}`],
      );
    });
    rows[slug] = rowId;
    ledger[slug] = ledgerId;
  }

  return { a: bySlug('tenant-a'), b: bySlug('tenant-b'), rows, ledger };
}

/** Every table carrying `tenant_id`, discovered the way the seam suite discovers them. */
export async function discoverTenantTables(): Promise<string[]> {
  const found = await asRole(
    'vextrus_migrate',
    `select table_schema, table_name
       from information_schema.columns
      where column_name = 'tenant_id'
        and table_schema not in ('pg_catalog', 'information_schema', 'drizzle')
      order by table_schema, table_name`,
  );
  if (found.error !== undefined) throw new Error(`discovery failed: ${found.error}`);
  return found.rows.map((row) => `${String(row['table_schema'])}.${String(row['table_name'])}`);
}

/**
 * A literal that satisfies a column's type, so an unscoped INSERT probe is
 * refused by the policy rather than by a NOT NULL constraint: Postgres runs
 * `ExecConstraints` (not-null, check) *before* the RLS WITH CHECK, so a probe
 * built out of nulls would prove nothing about row level security.
 * Undefined for a type this helper cannot synthesise.
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
 * A complete INSERT for `table` owned by `tenantId` — every column that has no
 * default and no null allowed, plus `tenant_id` whatever its default.
 * Undefined when a column's type is outside `literalFor`'s vocabulary.
 */
export async function syntheticInsert(
  table: string,
  tenantId: string,
): Promise<string | undefined> {
  const [schema, name] = table.split('.');
  const columns = await asRole(
    'vextrus_migrate',
    `select column_name, udt_name, is_nullable, column_default
       from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [schema ?? 'public', name ?? table],
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
  return `insert into ${table} (${names.join(', ')}) values (${values.join(', ')})`;
}
