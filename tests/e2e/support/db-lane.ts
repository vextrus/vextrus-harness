/**
 * Page object for the database lane (V-DB / SEAM-TENANT).
 *
 * Everything the journey needs to talk to the migrated database lives here: the
 * URLs of the three roles, a raw driver connection for the checks that must
 * happen *outside* the seam, the seam module itself, and the table discovery the
 * whole lane is built on.
 *
 * Two deliberate pieces of indirection:
 *
 * 1. The pg driver and `src/core/db.ts` are loaded through dynamic imports with
 *    non-literal specifiers. The seam does not exist in the tree yet, and this
 *    file has to typecheck under `pnpm typecheck` today: a static import of
 *    either would make the acceptance suite a compile error rather than a
 *    failing test, and a compile error proves nothing about the increment.
 *    At runtime the import resolves, or the test fails naming what is missing.
 *
 * 2. SQL is built with inlined, quoted literals rather than bound parameters.
 *    The shape of the object a seam handle hands to its unit of work is not
 *    pinned by the spec — it may be a driver client (`.query`) or a Drizzle
 *    transaction (`.execute`) — and only one of those takes a parameter array.
 *    Literals are the common denominator. Every value inlined here is minted by
 *    this suite (uuids, slugs), never user input.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { repoRoot, runCli, type CliResult } from '../../acceptance/support/cli';

/* ------------------------------------------------------------------ roles */

export const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'] as const;
export type RoleName = (typeof ROLES)[number];

/** The bootstrap/superuser URL — the same default the spec gives `db:migrate`. */
export const bootstrapUrl = (): string => {
  const override = (process.env['VDB_PG_URL'] ?? '').trim();
  return override === '' ? 'postgres://postgres:postgres@127.0.0.1:5544/postgres' : override;
};

export const appDatabase = (): string => {
  const override = (process.env['VDB_PG_DATABASE'] ?? '').trim();
  return override === '' ? 'vextrus_dev' : override;
};

/**
 * The connection URL for one role against the migrated database. Dev passwords
 * equal the role names (AC-01), so the URL is derivable rather than configured.
 */
export function roleUrl(role: RoleName, database: string = appDatabase()): string {
  const base = new URL(bootstrapUrl());
  base.username = role;
  base.password = role;
  base.pathname = `/${database}`;
  return base.toString();
}

/* ------------------------------------------------------------- sql values */

/** A single-quoted SQL literal. Doubling the quote is the whole escape. */
export const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const uuid = (): string => crypto.randomUUID();

/* ----------------------------------------------------------- the pg driver */

export interface SqlRow {
  readonly [column: string]: unknown;
}

export interface RawClient {
  query(text: string): Promise<{ rows: SqlRow[] }>;
  end(): Promise<void>;
}

interface ClientCtor {
  new (config: { connectionString: string }): RawClient & { connect(): Promise<void> };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const fn = (value: unknown): ((...args: unknown[]) => unknown) | undefined =>
  typeof value === 'function' ? (value as (...args: unknown[]) => unknown) : undefined;

/** Property bag of an object *or* a function — a callable handle carries methods too. */
const props = (value: unknown): Record<string, unknown> | undefined =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? (value as Record<string, unknown>)
    : undefined;

/** `pg` is a declared dependency of this increment; a miss here means it is absent. */
async function clientCtor(): Promise<ClientCtor> {
  const specifier = 'pg';
  let loaded: unknown;
  try {
    loaded = await import(/* @vite-ignore */ specifier);
  } catch (error) {
    throw new Error(
      `the pg driver could not be loaded — it is a declared dependency of this increment: ${String(error)}`,
    );
  }
  const mod = record(loaded) ?? {};
  const direct = mod['Client'];
  const viaDefault = record(mod['default'])?.['Client'];
  const ctor = direct ?? viaDefault;
  if (typeof ctor !== 'function') throw new Error('pg exported no Client constructor');
  return ctor as unknown as ClientCtor;
}

/** Connects as one role. The caller always ends the client. */
export async function connectAs(role: RoleName, database?: string): Promise<RawClient> {
  const Client = await clientCtor();
  const client = new Client({
    connectionString: database === undefined ? roleUrl(role) : roleUrl(role, database),
  });
  await client.connect();
  return client;
}

/** Connects with the bootstrap/superuser URL — used only to read the catalog. */
export async function connectBootstrap(database: string = appDatabase()): Promise<RawClient> {
  const Client = await clientCtor();
  const url = new URL(bootstrapUrl());
  url.pathname = `/${database}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

/** Runs `work` against a role connection and always closes it. */
export async function asRole<T>(
  role: RoleName,
  work: (client: RawClient) => Promise<T>,
  database?: string,
): Promise<T> {
  const client = database === undefined ? await connectAs(role) : await connectAs(role, database);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/* ------------------------------------------------------------- the seam */

export interface SeamModule {
  readonly forTenant: (ctx: { tenantId: string }) => unknown;
  readonly runAsSystem: (reason: string) => unknown;
}

export const SEAM_PATH = 'src/core/db.ts';

/** Imports the seam by absolute path, so no tsconfig alias has to resolve. */
export async function loadSeamNamespace(): Promise<Record<string, unknown>> {
  const url = pathToFileURL(join(repoRoot(), SEAM_PATH)).href;
  let loaded: unknown;
  try {
    loaded = await import(/* @vite-ignore */ url);
  } catch (error) {
    throw new Error(`${SEAM_PATH} could not be imported: ${String(error)}`);
  }
  const mod = record(loaded);
  if (mod === undefined) throw new Error(`${SEAM_PATH} exported nothing`);
  return mod;
}

export async function loadSeam(): Promise<SeamModule> {
  const mod = await loadSeamNamespace();
  const forTenant = fn(mod['forTenant']);
  const runAsSystem = fn(mod['runAsSystem']);
  if (forTenant === undefined || runAsSystem === undefined) {
    throw new Error(
      `${SEAM_PATH} must export forTenant and runAsSystem — saw [${Object.keys(mod).join(', ')}]`,
    );
  }
  return {
    forTenant: (ctx) => forTenant(ctx),
    runAsSystem: (reason) => runAsSystem(reason),
  };
}

/**
 * The ways a scoped handle may accept its unit of work.
 *
 * SEAM-TENANT pins the two function names and pins that the work runs in one
 * transaction; it does not pin how the work is handed over. Rather than invent a
 * name, the journey accepts any of these — a callable handle, or a handle with
 * one of these methods — and the contract spec states the same list where the
 * implementer can read it.
 */
export const HANDLE_INVOKERS = ['run', 'transaction', 'tx', 'withTransaction', 'do'] as const;

/** Runs `work` inside the handle's transaction, whatever shape the handle takes. */
export async function withHandle<T>(
  handle: unknown,
  work: (tx: unknown) => Promise<T>,
): Promise<T> {
  const callable = fn(handle);
  if (callable !== undefined) return (await callable(work)) as T;

  const holder = props(handle);
  if (holder !== undefined) {
    for (const name of HANDLE_INVOKERS) {
      const invoker = fn(holder[name]);
      if (invoker !== undefined) {
        return (await invoker.call(holder, work)) as T;
      }
    }
  }
  throw new Error(
    `the scoped handle takes no unit of work — expected a callable handle or one of [${HANDLE_INVOKERS.join(', ')}], saw ${
      holder === undefined ? typeof handle : `{ ${Object.keys(holder).join(', ')} }`
    }`,
  );
}

/** Runs SQL against whatever the handle passed in: a driver client or a Drizzle tx. */
export async function runSql(tx: unknown, text: string): Promise<SqlRow[]> {
  const target = props(tx);
  const query = target === undefined ? undefined : (fn(target['query']) ?? fn(target['execute']));
  if (query === undefined) {
    throw new Error(
      `the unit of work received no way to run SQL — expected .query or .execute, saw ${String(tx)}`,
    );
  }
  const result: unknown = await query.call(target, text);
  return rowsOf(result);
}

/** Normalises what a driver, a Drizzle execute, or a bare array hands back. */
export function rowsOf(result: unknown): SqlRow[] {
  if (Array.isArray(result)) return result as SqlRow[];
  const holder = record(result);
  const rows = holder?.['rows'];
  if (Array.isArray(rows)) return rows as SqlRow[];
  return [];
}

export const scalar = (rows: SqlRow[], column: string): unknown => rows[0]?.[column];

export const count = (rows: SqlRow[]): number => Number(scalar(rows, 'count') ?? 0);

/* ------------------------------------------------------------- refusals */

export interface Refusal {
  readonly refused: boolean;
  readonly code: string;
  readonly message: string;
}

/** SQLSTATE 42501 covers both a policy refusal and a missing grant. */
export const INSUFFICIENT_PRIVILEGE = '42501';

/** Runs `attempt` and reports how the database refused it, if it did. */
export async function refusal(attempt: () => Promise<unknown>): Promise<Refusal> {
  try {
    await attempt();
    return { refused: false, code: '', message: '' };
  } catch (error) {
    const holder = record(error);
    const code = typeof holder?.['code'] === 'string' ? holder['code'] : '';
    return { refused: true, code, message: error instanceof Error ? error.message : String(error) };
  }
}

/** True when the refusal is row-level security rather than a shape complaint. */
export const isRlsRefusal = (r: Refusal): boolean =>
  r.refused && (r.code === INSUFFICIENT_PRIVILEGE || /row-level security|policy/i.test(r.message));

/* ------------------------------------------------------------- discovery */

export interface TenantTable {
  readonly schema: string;
  readonly name: string;
  readonly qualified: string;
}

/**
 * Every relation carrying a `tenant_id` column, outside the migration ledger and
 * the system schemas — the same population the lane's own suite must discover
 * (AC-02). Read from the catalog, never from a list in a file.
 *
 * `relkind in ('r', 'p')`: a partitioned table is one tenant table spread over
 * several catalog rows, and the parent ('p') is the one queries and policies
 * address. A population of 'r' alone finds the partitions and never the parent.
 */
export async function discoverTenantTables(client: RawClient): Promise<TenantTable[]> {
  const { rows } = await client.query(`
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
     and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
      and n.nspname not like 'pg_%'
    order by n.nspname, c.relname
  `);
  return rows.map((row) => {
    const schema = String(row['schema_name']);
    const name = String(row['table_name']);
    return { schema, name, qualified: `"${schema}"."${name}"` };
  });
}

/* -------------------------------------------------------------- fixtures */

export const TENANT_A_SLUG = 'tenant-a';
export const TENANT_B_SLUG = 'tenant-b';

export interface SeamFixtures {
  readonly tenantA: string;
  readonly tenantB: string;
  /** A `seam_probe_rows` id per tenant, for the composite-FK and update checks. */
  readonly probeRowA: string;
  readonly probeRowB: string;
}

/**
 * Seeds the two tenants and one probe row plus one ledger row each, through
 * `runAsSystem` — the fixture route the test contract names. Tenant uuids are
 * minted at seed time and read back by slug, so a tree that already has them
 * keeps them.
 */
export async function seedFixtures(): Promise<SeamFixtures> {
  const seam = await loadSeam();

  await withHandle(seam.runAsSystem('seed: seam fixtures'), async (tx) => {
    for (const slug of [TENANT_A_SLUG, TENANT_B_SLUG]) {
      await runSql(
        tx,
        `insert into tenants (id, slug, name)
         values (${lit(uuid())}, ${lit(slug)}, ${lit(slug)})
         on conflict (slug) do nothing`,
      );
    }
  });

  const ids = await withHandle(seam.runAsSystem('seed: read tenant ids'), async (tx) =>
    runSql(
      tx,
      `select slug, id::text as id from tenants where slug in (${lit(TENANT_A_SLUG)}, ${lit(TENANT_B_SLUG)})`,
    ),
  );
  const bySlug = new Map(ids.map((row) => [String(row['slug']), String(row['id'])]));
  const tenantA = bySlug.get(TENANT_A_SLUG);
  const tenantB = bySlug.get(TENANT_B_SLUG);
  if (tenantA === undefined || tenantB === undefined) {
    throw new Error(`seeded tenants not readable by slug — saw [${[...bySlug.keys()].join(', ')}]`);
  }

  const probeRowA = uuid();
  const probeRowB = uuid();
  await withHandle(seam.runAsSystem('seed: probe rows'), async (tx) => {
    for (const [tenantId, rowId, slug] of [
      [tenantA, probeRowA, TENANT_A_SLUG],
      [tenantB, probeRowB, TENANT_B_SLUG],
    ] as const) {
      await runSql(
        tx,
        `insert into seam_probe_rows (id, tenant_id, label)
         values (${lit(rowId)}, ${lit(tenantId)}, ${lit(`probe of ${slug}`)})`,
      );
      await runSql(
        tx,
        `insert into seam_probe_ledger (id, tenant_id, row_id, note)
         values (${lit(uuid())}, ${lit(tenantId)}, ${lit(rowId)}, ${lit(`ledger of ${slug}`)})`,
      );
    }
  });

  return { tenantA, tenantB, probeRowA, probeRowB };
}

/* --------------------------------------------------------------- the CLI */

export const pnpm = (args: readonly string[], env: Record<string, string> = {}): CliResult =>
  runCli('pnpm', args, env, 300_000);
