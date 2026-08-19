/**
 * SEAM-TENANT — the only two database handles this codebase has.
 *
 * `forTenant(ctx)` and `runAsSystem(reason)` are the entire public surface: no
 * pool, no schema, no driver leaves this module, so "every query runs through
 * the seam" (R-SPINE-004) is a fact about the import graph rather than a habit.
 *
 * Both handles do the same three things and differ only in the setting they
 * make:
 *
 *   - they connect as `vextrus_app`, never as the owner, so row-level security
 *     is in force for the connection the work runs on;
 *   - they open one transaction, and the unit of work runs inside it — the whole
 *     thing commits or none of it does;
 *   - they set their scope with `set_config(..., true)`. The `true` is the
 *     transaction-local flag, and it is the difference between a scope that ends
 *     with the transaction and one that rides a pooled connection into the next
 *     request. A plain `SET` passes every test that looks at one caller.
 *
 * The policies in the schema key on exactly these two settings, so a handle that
 * failed to make its setting reads nothing and writes nothing: the failure mode
 * is an empty result, never another tenant's data.
 */
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

/** What a unit of work is handed: a live client inside the open transaction. */
export interface Scoped {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A scoped handle: call it with the work that must run under that scope. */
export type Handle = <T>(work: (tx: Scoped) => Promise<T>) => Promise<T>;

const DEFAULT_BOOTSTRAP_URL = 'postgres://postgres:postgres@127.0.0.1:5544/postgres';
const DEFAULT_DATABASE = 'vextrus_dev';
const DEFAULT_POOL_SIZE = 5;

/** An exported-but-empty override is a shell accident, not a configuration. */
const setting = (name: string, fallback: string): string => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

/**
 * The runtime URL, derived from the bootstrap URL rather than configured
 * separately: one host, one port, one database, and a role this module is not
 * free to change. Dev passwords equal role names.
 */
function runtimeUrl(): string {
  const url = new URL(setting('VDB_PG_URL', DEFAULT_BOOTSTRAP_URL));
  url.username = 'vextrus_app';
  url.password = 'vextrus_app';
  url.pathname = `/${setting('VDB_PG_DATABASE', DEFAULT_DATABASE)}`;
  return url.toString();
}

let pool: Pool | undefined;

/**
 * One pool per process, made on first use.
 *
 * `allowExitOnIdle` matters: nothing outside this module can close the pool —
 * that would be a third export — so an idle connection must not be what keeps a
 * finished process alive.
 */
function connections(): Pool {
  if (pool === undefined) {
    const size = Number(setting('VDB_POOL_SIZE', String(DEFAULT_POOL_SIZE)));
    pool = new Pool({
      connectionString: runtimeUrl(),
      max: Number.isInteger(size) && size > 0 ? size : DEFAULT_POOL_SIZE,
      allowExitOnIdle: true,
    });
  }
  return pool;
}

/**
 * One transaction, one scope, one unit of work.
 *
 * The settings are made *inside* the transaction and marked transaction-local,
 * so they are gone the moment it ends however it ends — commit, rollback, or a
 * throw from the work itself.
 */
function scopedHandle(settings: readonly (readonly [string, string])[]): Handle {
  return async <T>(work: (tx: Scoped) => Promise<T>): Promise<T> => {
    const client: PoolClient = await connections().connect();
    try {
      await client.query('begin');
      try {
        for (const [name, value] of settings) {
          await client.query('select set_config($1, $2, true)', [name, value]);
        }
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
  };
}

/**
 * The tenant-scoped handle. Every row the work can see or write is one whose
 * `tenant_id` matches — enforced by the database, not by the caller remembering
 * a WHERE clause.
 */
export function forTenant(ctx: { tenantId: string }): Handle {
  const tenantId = typeof ctx.tenantId === 'string' ? ctx.tenantId.trim() : '';
  if (tenantId === '') {
    throw new Error('TENANT_REQUIRED: forTenant needs a non-empty ctx.tenantId');
  }
  return scopedHandle([['app.tenant_id', tenantId]]);
}

/**
 * The escape, and it is meant to be conspicuous: it demands a reason and writes
 * that reason to stderr, so every unscoped transaction is a line somebody can
 * grep for. The composite tenant FKs still hold here — the backstop the policies
 * are not the only copy of.
 */
export function runAsSystem(reason: string): Handle {
  const given = typeof reason === 'string' ? reason.trim() : '';
  if (given === '') {
    throw new Error('SYSTEM_REASON_REQUIRED: runAsSystem needs a non-empty reason');
  }
  process.stderr.write(`SEAM-TENANT runAsSystem reason=${given}\n`);
  return scopedHandle([['app.system', 'on']]);
}
