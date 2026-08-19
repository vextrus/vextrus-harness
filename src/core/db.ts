/**
 * SEAM-TENANT — the only two database handles in the system.
 *
 * `forTenant(ctx)` scopes a unit of work to one tenant; `runAsSystem(reason)`
 * steps outside tenancy on purpose and says why, in the log, where somebody can
 * find it later. Nothing else is exported: no pool, no driver, no schema, no
 * escape hatch. R-SPINE-004 is "every query runs through the seam", and a seam
 * with a side door is not a seam.
 *
 * Both handles hand their work a transaction on a `vextrus_app` connection —
 * never the owner — and set their scope with `set_config(..., true)`. The third
 * argument is the whole point. Without it the setting outlives the transaction
 * and rides the pooled connection to whoever checks it out next, which is the
 * classic multi-tenant leak: every public test still passes and one request in a
 * hundred reads another tenant's rows. With it, the scope dies with the
 * transaction and an unscoped connection sees nothing, because the RLS policies
 * key on a setting that is simply absent.
 */
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

/** The runtime role. RLS-subject, no ownership, and the only role this file knows. */
const APP_ROLE = 'vextrus_app';

/**
 * An exported-but-empty override is the ordinary shell accident, so it falls
 * back to the default rather than pointing the seam at the empty string — the
 * convention `CHECKUP_PG_PORT` already set in `scripts/checkup.d/`.
 */
const envOr = (name: string, fallback: string): string => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

/**
 * The runtime URL, derived from the bootstrap URL rather than configured beside
 * it: one place to point the lane at a database, and no way to point the seam at
 * a different one — or at a stronger role — by editing half the environment.
 */
const appUrl = (): string => {
  const url = new URL(envOr('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres'));
  url.username = APP_ROLE;
  url.password = APP_ROLE;
  url.pathname = `/${envOr('VDB_PG_DATABASE', 'vextrus_dev')}`;
  return url.toString();
};

/** The unit of work a scoped handle runs: one transaction, one client. */
type Work<T> = (tx: PoolClient) => Promise<T>;

/** A scoped handle is callable — you hand it the work, it hands you the answer. */
type ScopedHandle = <T>(work: Work<T>) => Promise<T>;

let pool: Pool | undefined;

/**
 * Built on first use, not on import: importing the seam must not open sockets,
 * so a tool that only reads this module's surface never touches the database.
 * `allowExitOnIdle` keeps an idle pool from holding a finished process open —
 * there is no `close()` to export, because the surface is exactly two functions.
 */
const handles = (): Pool => {
  pool ??= new Pool({
    connectionString: appUrl(),
    max: Number(envOr('VDB_POOL_SIZE', '5')),
    allowExitOnIdle: true,
  });
  return pool;
};

/**
 * One transaction, with `scope` applied transaction-locally before the work sees
 * the connection. A failure rolls back — including the settings, which is the
 * other half of why they are transaction-local.
 */
async function run<T>(scope: (tx: PoolClient) => Promise<void>, work: Work<T>): Promise<T> {
  const client = await handles().connect();
  try {
    await client.query('begin');
    try {
      await scope(client);
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * The tenant-scoped handle. Every row the work can read or write belongs to
 * `ctx.tenantId`; the policies decide that, not this file, and the composite
 * tenant foreign keys decide it again when a policy is not enough.
 */
export function forTenant(ctx: { tenantId: string }): ScopedHandle {
  const tenantId = typeof ctx?.tenantId === 'string' ? ctx.tenantId.trim() : '';
  if (tenantId === '') {
    const error = new Error('TENANT_REQUIRED: forTenant needs a non-empty ctx.tenantId');
    error.name = 'TENANT_REQUIRED';
    throw error;
  }
  return <T>(work: Work<T>): Promise<T> =>
    run(async (tx) => {
      await tx.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    }, work);
}

/**
 * The deliberate way out of tenancy — migrations' seed data, cross-tenant
 * reporting, anything that is honestly not one tenant's business. It costs a
 * reason, and the reason is on stderr before the transaction opens, so an
 * unexplained system-scoped write is not a thing that can happen quietly.
 */
export function runAsSystem(reason: string): ScopedHandle {
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why === '') {
    const error = new Error('SYSTEM_REASON_REQUIRED: runAsSystem needs a reason');
    error.name = 'SYSTEM_REASON_REQUIRED';
    throw error;
  }
  process.stderr.write(`SEAM-TENANT runAsSystem reason=${why}\n`);
  return <T>(work: Work<T>): Promise<T> =>
    run(async (tx) => {
      await tx.query(`select set_config('app.system', 'on', true)`);
    }, work);
}
