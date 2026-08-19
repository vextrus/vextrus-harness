/**
 * SEAM-TENANT: the only two database handles this codebase has.
 *
 * Everything that touches Postgres goes through `forTenant(ctx)` or
 * `runAsSystem(reason)`, and nothing else is exported from here — no pool, no
 * driver, no schema, not even a way to close the pool. That is the seam: one
 * file to read to know how a query can possibly reach the database, and one file
 * for the boundary rule to point at.
 *
 * Each handle runs its unit of work in exactly one transaction on a
 * `vextrus_app` connection, with its scope set transaction-locally:
 *
 *     set_config('app.tenant_id', <id>, true)
 *     set_config('app.system', 'on', true)
 *
 * The third argument is the whole design. `SET` without it survives onto the
 * next checkout of the same pooled connection, so a tenant's scope would leak
 * into the next request's — every public test would still pass, and the seam
 * would be a lie (B-03). Transaction-local, the setting dies with the
 * transaction, whether it committed or rolled back.
 *
 * The database is the backstop, not this file: the policies key on those two
 * settings, RLS is forced on every tenant-scoped table, and the composite tenant
 * foreign keys refuse a cross-tenant reference even under `runAsSystem`. This
 * seam decides which scope a transaction runs in; the database decides what that
 * scope may do.
 */
import pg from 'pg';

/** The unit of work a handle runs, inside its transaction. */
export type Work<T> = (tx: pg.PoolClient) => Promise<T>;

/**
 * A scoped handle. `run` is the only thing to do with one — obtaining a handle
 * costs nothing and touches no connection; running work is what opens the
 * transaction.
 */
export interface ScopedHandle {
  run<T>(work: Work<T>): Promise<T>;
}

/**
 * An exported-but-empty variable falls back to the default, the same way
 * `CHECKUP_PG_PORT` does in the machine report.
 */
const env = (name: string, fallback: string): string => {
  const raw = (process.env[name] ?? '').trim();
  return raw === '' ? fallback : raw;
};

/**
 * The runtime connection: always the RLS-subject role, never the owner. The
 * bootstrap URL is where the host, port and password scheme come from — the dev
 * passwords equal the role names — and the role is not configurable, because a
 * seam that can be pointed at a more privileged role is not a seam.
 */
function runtimeUrl(): string {
  const url = new URL(env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres'));
  url.username = 'vextrus_app';
  url.password = 'vextrus_app';
  url.pathname = `/${env('VDB_PG_DATABASE', 'vextrus_dev')}`;
  return url.toString();
}

let pool: pg.Pool | undefined;

/**
 * One pool per process, built on first use. `allowExitOnIdle` keeps an idle pool
 * from holding a short-lived process (a test run, a script) open — with no
 * `close()` export, the pool must not be the reason a process cannot end.
 */
function connections(): pg.Pool {
  if (pool === undefined) {
    const size = Number(env('VDB_POOL_SIZE', '5'));
    pool = new pg.Pool({
      connectionString: runtimeUrl(),
      max: Number.isInteger(size) && size > 0 ? size : 5,
      allowExitOnIdle: true,
    });
    // An idle client killed by the server must not take the process with it.
    pool.on('error', () => undefined);
  }
  return pool;
}

function refuse(name: string, detail: string): never {
  const error = new Error(`${name}: ${detail}`);
  error.name = name;
  throw error;
}

/**
 * One transaction, one scope. The settings are applied inside the transaction
 * that runs the work, so there is no window in which a connection carries a
 * scope without being in the transaction that owns it.
 */
async function inTransaction<T>(settings: ReadonlyArray<readonly [string, string]>, work: Work<T>): Promise<T> {
  const client = await connections().connect();
  try {
    await client.query('BEGIN');
    for (const [setting, value] of settings) {
      await client.query('SELECT set_config($1, $2, true)', [setting, value]);
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // A failed rollback must not replace the diagnosis with its own noise: the
    // caller needs the error that actually refused the work.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The tenant-scoped handle. Every row the work can see or write belongs to
 * `ctx.tenantId`, because the policies key on the setting this sets and the
 * database — not this function — enforces it.
 */
export function forTenant(ctx: { tenantId: string }): ScopedHandle {
  const tenantId = typeof ctx?.tenantId === 'string' ? ctx.tenantId.trim() : '';
  if (tenantId === '') {
    refuse('TENANT_REQUIRED', 'forTenant needs a non-empty ctx.tenantId — there is no default tenant');
  }
  return {
    run: <T>(work: Work<T>): Promise<T> => inTransaction([['app.tenant_id', tenantId]], work),
  };
}

/**
 * The system handle: the deliberate way past the tenant scope, for the work that
 * has no tenant — seeding, migration-adjacent maintenance, cross-tenant
 * reporting.
 *
 * The reason is mandatory and it is logged, because an escape nobody can see in
 * the transcript is an escape nobody audits. The composite tenant foreign keys
 * still hold here: `runAsSystem` widens what may be read, never what may be
 * made inconsistent.
 */
export function runAsSystem(reason: string): ScopedHandle {
  const given = typeof reason === 'string' ? reason.trim() : '';
  if (given === '') {
    refuse('SYSTEM_REASON_REQUIRED', 'runAsSystem needs a reason — an unexplained escape is not an escape');
  }
  process.stderr.write(`SEAM-TENANT runAsSystem reason=${given}\n`);
  return {
    run: <T>(work: Work<T>): Promise<T> => inTransaction([['app.system', 'on']], work),
  };
}
