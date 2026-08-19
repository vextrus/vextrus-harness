/**
 * SEAM-TENANT — the only two database handles this application has.
 *
 * `forTenant(ctx)` is every ordinary query. `runAsSystem(reason)` is the bounded,
 * logged escalation for the handful of things that are not a tenant's work:
 * registering a tenant, a migration's data step, a system job. There is no third
 * handle, no exported pool, no re-exported driver or schema — R-SPINE-004 says
 * every query runs through this seam, and a seam with a way around it is not one.
 *
 * Each handle runs its work inside exactly one transaction on a `vextrus_app`
 * connection, with its settings applied by `set_config(..., true)`. The `true` is
 * the whole point: it makes the setting transaction-local, so it dies with the
 * transaction instead of riding a pooled connection into the next request. A
 * plain `SET` passes every test that only ever uses one connection and leaks a
 * tenant the first time it does not.
 *
 * `vextrus_app` is not the owner and does not bypass RLS, so the policies and the
 * composite tenant foreign keys are enforced against this connection by the
 * database — not by the care taken in this file.
 */
import { Pool } from 'pg';

/** A row as the driver hands it back; the caller knows its own shape. */
type Row = Record<string, unknown>;

interface Session {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

interface Handle {
  run<T>(work: (session: Session) => Promise<T>): Promise<T>;
}

/** An exported-but-empty override falls back to the default (the CHECKUP_PG_PORT convention). */
function env(name: string, fallback: string): string {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
}

/**
 * The runtime connection: the bootstrap URL's host and port, the app role's
 * credentials, the app database. The bootstrap URL is a superuser URL and its
 * credentials are deliberately discarded here — this module cannot connect as
 * anything but `vextrus_app` even if the environment hands it a superuser.
 */
function appConnectionString(): string {
  const url = new URL(env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres'));
  url.username = 'vextrus_app';
  url.password = 'vextrus_app';
  url.pathname = `/${env('VDB_PG_DATABASE', 'vextrus_dev')}`;
  return url.toString();
}

let pool: Pool | undefined;

/**
 * One pool per process, built on first use rather than at import: importing the
 * seam must not open sockets, or every test that merely reads its surface would
 * need a database.
 *
 * `allowExitOnIdle` so an idle pool never becomes the reason a process will not
 * exit — a test runner that hangs at the end is a test runner nobody trusts.
 */
function connections(): Pool {
  if (pool === undefined) {
    const size = Number.parseInt(env('VDB_POOL_SIZE', '5'), 10);
    pool = new Pool({
      connectionString: appConnectionString(),
      max: Number.isInteger(size) && size > 0 ? size : 5,
      allowExitOnIdle: true,
    });
  }
  return pool;
}

/**
 * The one transaction, with the seam's settings applied inside it.
 *
 * Settings go through `set_config($1, $2, true)` rather than `SET LOCAL` because
 * the value is data — a tenant id off the request — and `SET LOCAL` takes no
 * parameters, so it would have to be built by string concatenation. That is the
 * shape of an injection, on the setting the whole isolation model keys on.
 */
async function transact<T>(
  settings: ReadonlyArray<readonly [string, string]>,
  work: (session: Session) => Promise<T>,
): Promise<T> {
  const client = await connections().connect();
  try {
    await client.query('begin');
    for (const [name, value] of settings) {
      await client.query('select set_config($1, $2, true)', [name, value]);
    }
    const session: Session = {
      query: async (text, params) => {
        const result = await client.query(text, params === undefined ? undefined : [...params]);
        return { rows: result.rows as Row[] };
      },
    };
    const answer = await work(session);
    await client.query('commit');
    return answer;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The tenant-scoped handle. `ctx.tenantId` is required and is checked here, at
 * the call, so a missing tenant is a programming error at the seam rather than
 * an empty result set somewhere downstream that looks like "no data".
 */
export function forTenant(ctx: { tenantId: string }): Handle {
  const tenantId = typeof ctx?.tenantId === 'string' ? ctx.tenantId.trim() : '';
  if (tenantId === '') {
    throw new Error('TENANT_REQUIRED: forTenant needs a non-empty ctx.tenantId');
  }
  return {
    run: (work) => transact([['app.tenant_id', tenantId]], work),
  };
}

/**
 * The escalation. The reason is required and is written to stderr every time the
 * transaction opens: `runAsSystem` is rare and auditable by construction, and a
 * reason nobody had to supply is a reason nobody would have written.
 */
export function runAsSystem(reason: string): Handle {
  const given = typeof reason === 'string' ? reason.trim() : '';
  if (given === '') {
    throw new Error('SYSTEM_REASON_REQUIRED: runAsSystem needs a non-empty reason');
  }
  return {
    run: (work) => {
      process.stderr.write(`SEAM-TENANT runAsSystem reason=${given}\n`);
      return transact([['app.system', 'on']], work);
    },
  };
}
