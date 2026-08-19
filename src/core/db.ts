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
 * A pool size the driver cannot honour is worse than a wrong one: `max: -1`
 * hands out no client at all, so every handle's promise waits forever — no
 * error, no timeout, nothing to read from outside. Anything that is not a
 * positive whole number falls back to the default, the same way an
 * exported-but-empty value already does.
 */
const poolSize = (): number => {
  const requested = Number(envOr('VDB_POOL_SIZE', '5'));
  return Number.isInteger(requested) && requested > 0 ? requested : 5;
};

/**
 * Built on first use, not on import: importing the seam must not open sockets,
 * so a tool that only reads this module's surface never touches the database.
 * `allowExitOnIdle` keeps an idle pool from holding a finished process open —
 * there is no `close()` to export, because the surface is exactly two functions.
 */
const handles = (): Pool => {
  if (pool === undefined) {
    const fresh = new Pool({
      connectionString: appUrl(),
      max: poolSize(),
      allowExitOnIdle: true,
    });
    /**
     * A pool without an error listener is a process that exits on a network
     * blip: `pg` re-emits an *idle* client's background failure on the pool
     * itself, not on anybody's pending query, and an unhandled 'error' event
     * takes Node down — every other tenant's in-flight request with it. The
     * pool retires the broken client on its own; the listener's job is to say
     * so where an operator can read it, and to let the process live.
     */
    fresh.on('error', (error: Error) => {
      process.stderr.write(`SEAM-TENANT pool client error: ${error.message}\n`);
    });
    pool = fresh;
  }
  return pool;
};

/**
 * One transaction, with `scope` applied transaction-locally before the work sees
 * the connection. A failure rolls back — including the settings, which is the
 * other half of why they are transaction-local.
 */
async function run<T>(scope: (tx: PoolClient) => Promise<void>, work: Work<T>): Promise<T> {
  const client = await handles().connect();
  /** Set when the connection must be destroyed rather than pooled. */
  let poisoned: Error | undefined;
  /**
   * The pool's own error listener covers its *idle* clients. A client checked
   * out for this transaction is nobody's but ours, and `pg` emits its
   * background failures — a Postgres restart, a terminated backend, a dropped
   * socket — on the client itself. Unhandled, that is an 'error' event with no
   * listener, which takes the process down and every other tenant's in-flight
   * work with it. Here it is recorded instead: the in-flight query still
   * rejects on its own, and the connection is destroyed rather than pooled.
   */
  const onClientError = (error: Error): void => {
    poisoned = error;
    process.stderr.write(`SEAM-TENANT connection lost mid-transaction: ${error.message}\n`);
  };
  client.on('error', onClientError);
  try {
    await client.query('begin');
    try {
      await scope(client);
      const result = await work(client);
      /**
       * `commit` on a transaction Postgres has already marked aborted does not
       * fail — the server discards the work and answers with the command tag
       * `ROLLBACK`. A unit of work that caught a failing statement of its own
       * and carried on would otherwise be told it committed while every write
       * it made is gone. One transaction means one honest verdict.
       */
      const committed = await client.query('commit');
      if (committed.command === 'ROLLBACK') {
        throw new Error(
          'TRANSACTION_DISCARDED: the transaction was aborted before commit, so no work was kept',
        );
      }
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch (rollbackError) {
        /**
         * The rollback itself failed: the connection is in an unknown protocol
         * state, so it must not go back into the pool for the next tenant to
         * check out mid-aborted-transaction. It is destroyed instead — and the
         * caller still gets their own error, because the rollback's is a fact
         * about the socket, not about what they asked for.
         */
        poisoned = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        process.stderr.write(`SEAM-TENANT rollback failed: ${poisoned.message}\n`);
      }
      throw error;
    }
  } finally {
    client.removeListener('error', onClientError);
    if (poisoned === undefined) client.release();
    else client.release(poisoned);
  }
}

/**
 * The policies compare `tenant_id::text` — always the canonical lower-case,
 * dashed form — with the raw string in `app.tenant_id`, so the spelling of a
 * tenant id is part of the scope. An upper-case uuid out of a JWT claim or a URL
 * would address nobody: reads come back empty and writes are refused, and the
 * seam would have said nothing about why. So a uuid is canonicalised to the one
 * spelling the policies can match, and anything that is not a uuid is refused
 * where the caller can see it rather than turned into a silently empty tenant.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const canonicalTenantId = (value: string): string => {
  if (!UUID.test(value)) {
    const error = new Error(`TENANT_REQUIRED: ctx.tenantId must be a uuid, got ${JSON.stringify(value)}`);
    error.name = 'TENANT_REQUIRED';
    throw error;
  }
  return value.toLowerCase();
};

/**
 * The tenant-scoped handle. Every row the work can read or write belongs to
 * `ctx.tenantId`; the policies decide that, not this file, and the composite
 * tenant foreign keys decide it again when a policy is not enough.
 */
export function forTenant(ctx: { tenantId: string }): ScopedHandle {
  const raw = typeof ctx?.tenantId === 'string' ? ctx.tenantId.trim() : '';
  if (raw === '') {
    const error = new Error('TENANT_REQUIRED: forTenant needs a non-empty ctx.tenantId');
    error.name = 'TENANT_REQUIRED';
    throw error;
  }
  const tenantId = canonicalTenantId(raw);
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
