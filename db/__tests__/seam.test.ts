/**
 * V-DB — the live seam suite. It is the proof SEAM-TENANT is real: RLS per table,
 * cross-tenant refusal, append-only grants, composite tenant foreign keys, the
 * role split and the migration ledger, all against a migrated Postgres.
 *
 *   pnpm db:migrate && pnpm test:db
 *
 * The suite names no application table. It asks the migrated database which
 * tables carry `tenant_id` and proves the four seam facts against each one, so
 * the increment that adds `projects` adds no test — and the increment that adds a
 * table without forced RLS goes red without anyone having remembered to look
 * (Q-02: V-DB green on every table). The held-out `rls_gap` table below is that
 * claim's own proof: the coverage check fails when it should.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { forTenant, runAsSystem } from '../../src/core/db';
import { APPEND_ONLY_TABLES } from '../schema';
import {
  ROLES,
  appHasPrivilege,
  asRole,
  discoverTenantTables,
  refusal,
  rlsState,
  stableUuid,
  syntheticInsert,
  type TenantTable,
} from './support/live';

/**
 * Discovery happens at collection time, at the top level, because the tables are
 * what the suite is made of: `describe` per discovered table is how "every table
 * that carries tenant_id" becomes a list of test names somebody can read.
 */
const tables: TenantTable[] = await discoverTenantTables();

const TENANT_SLUGS = ['tenant-a', 'tenant-b'] as const;

/** Forced, enabled, and carrying a policy — each alone leaves the table open. */
const isCovered = (state: { enabled: boolean; forced: boolean; policies: number }): boolean =>
  state.enabled && state.forced && state.policies > 0;

let tenantA = '';
let tenantB = '';

beforeAll(async () => {
  // One seed for the whole run (the 30 s budget is a budget for the suite, not
  // for each test): two tenants registered through the system handle, then one
  // row and one ledger entry per tenant written through the tenant handle — the
  // only two ways this codebase is allowed to reach the database.
  const registered = await runAsSystem('seed: V-DB fixtures').run(async (session) => {
    for (const slug of TENANT_SLUGS) {
      await session.query(
        'insert into tenants (id, slug, name) values ($1, $2, $3) on conflict (slug) do nothing',
        [crypto.randomUUID(), slug, slug],
      );
    }
    return (await session.query('select id, slug from tenants where slug = any($1)', [
      [...TENANT_SLUGS],
    ])).rows;
  });

  const bySlug = (slug: string): string => {
    const found = registered.find((row) => row['slug'] === slug);
    if (found === undefined) throw new Error(`seed: tenant ${slug} was not registered`);
    return String(found['id']);
  };
  tenantA = bySlug('tenant-a');
  tenantB = bySlug('tenant-b');

  // Stable ids and `on conflict do nothing`, like the `tenants` insert above: the
  // probe tables are permanent and the dev Postgres is a persistent install, so a
  // fresh uuid per run would grow both tables — the ledger unrecoverably, since
  // nothing may delete from it — for the life of the project, and every
  // scoped-read reads all of it (AC-02's 30 s).
  for (const tenantId of [tenantA, tenantB]) {
    const rowId = stableUuid(`seam_probe_rows ${tenantId}`);
    await forTenant({ tenantId }).run(async (session) => {
      await session.query(
        'insert into seam_probe_rows (id, tenant_id, label) values ($1, $2, $3)' +
          ' on conflict (tenant_id, id) do nothing',
        [rowId, tenantId, 'seam probe row'],
      );
      await session.query(
        'insert into seam_probe_ledger (id, tenant_id, row_id, note) values ($1, $2, $3, $4)' +
          ' on conflict (tenant_id, id) do nothing',
        [stableUuid(`seam_probe_ledger ${tenantId}`), tenantId, rowId, 'seam probe ledger entry'],
      );
    });
  }
});

describe('V-DB the discovered population', () => {
  test('the two permanent probe tables are in it', () => {
    const names = tables.map((table) => table.qualified);
    expect(names).toContain('public.seam_probe_rows');
    expect(names).toContain('public.seam_probe_ledger');
  });

  /**
   * The registry scopes on `id`, not `tenant_id` — and it is the one table whose
   * leak enumerates every customer. Discovery that keyed on the column name
   * alone left it out of every fact, so dropping its policy or its FORCE RLS
   * would have gone unnoticed. Q-02 says every table.
   */
  test('the tenant registry is in it, scoped on its own id', () => {
    const registry = tables.find((table) => table.qualified === 'public.tenants');
    expect(registry, 'the tenants registry was not discovered').toBeDefined();
    expect(registry?.scope).toBe('id');
  });

  test('every discovered table can be probed with a synthetic insert', async () => {
    let probeable = 0;
    for (const table of tables) {
      if ((await syntheticInsert(table, tenantA)) !== undefined) probeable += 1;
    }
    // Below two, the per-table refusal facts would be passing vacuously.
    expect(probeable, 'too few tables could be probed for the refusal facts').toBeGreaterThanOrEqual(
      2,
    );
  });
});

for (const table of tables) {
  describe(`V-DB ${table.qualified}`, () => {
    test(`rls-coverage — ${table.qualified} has row level security enabled, forced and policied`, async () => {
      const state = await rlsState(table);
      expect(state.enabled, `${table.qualified} does not have RLS enabled`).toBe(true);
      // FORCE, or the owner — the role that runs every migration — is exempt.
      expect(state.forced, `${table.qualified} does not FORCE row level security`).toBe(true);
      expect(state.policies, `${table.qualified} carries no policy`).toBeGreaterThan(0);
      expect(isCovered(state)).toBe(true);
    });

    test(`scoped-read — ${table.qualified} shows a tenant its own rows and no others`, async () => {
      const everything = await runAsSystem(`V-DB scoped-read ${table.qualified}`).run(
        async (session) =>
          (await session.query(`select ${table.scope} as scope from ${table.qualified}`)).rows,
      );

      for (const tenantId of [tenantA, tenantB]) {
        const scoped = await forTenant({ tenantId }).run(
          async (session) =>
            (await session.query(`select ${table.scope} as scope from ${table.qualified}`)).rows,
        );
        const foreign = scoped.filter((row) => String(row['scope']) !== tenantId);
        expect(foreign, `${table.qualified} leaked another tenant's rows`).toEqual([]);

        const expected = everything.filter((row) => String(row['scope']) === tenantId);
        expect(scoped.length, `${table.qualified} hid rows from their own tenant`).toBe(
          expected.length,
        );
      }
    });

    test(`rls-refusal — ${table.qualified} is invisible and unwritable without a tenant`, async () => {
      const read = await asRole('vextrus_app', `select * from ${table.qualified}`);
      expect(read.error, `${table.qualified}: ${String(read.error)}`).toBeUndefined();
      expect(read.rows, `${table.qualified} returned rows with no tenant setting`).toEqual([]);

      const statement = await syntheticInsert(table, tenantA);
      if (statement === undefined) return;
      const written = await asRole('vextrus_app', statement);
      expect(written.error, `${table.qualified} accepted an unscoped insert`).toMatch(
        /row-level security|policy|permission denied/i,
      );
    });

    test(`cross-tenant-write-refusal — ${table.qualified} refuses a write owned by another tenant`, async () => {
      const statement = await syntheticInsert(table, tenantB);
      if (statement === undefined) return;
      const message = await refusal(
        forTenant({ tenantId: tenantA }).run(async (session) => {
          await session.query(statement);
        }),
      );
      expect(message, `${table.qualified} let tenant A insert a row owned by tenant B`).toMatch(
        /row-level security|policy|violates|permission denied/i,
      );
    });

    test(`append-only-grants — ${table.qualified} holds exactly the write verbs it declares`, async () => {
      const appendOnly = APPEND_ONLY_TABLES.includes(table.name);
      expect(await appHasPrivilege(table, 'SELECT')).toBe(true);
      expect(await appHasPrivilege(table, 'INSERT')).toBe(true);
      expect(await appHasPrivilege(table, 'UPDATE'), `${table.qualified} UPDATE grant`).toBe(
        !appendOnly,
      );
      expect(await appHasPrivilege(table, 'DELETE'), `${table.qualified} DELETE grant`).toBe(
        !appendOnly,
      );

      // A no-op update: it needs the privilege and satisfies the same WITH CHECK
      // any real update would, so it separates "may write" from "may write here".
      const touch = `update ${table.qualified} set ${table.scope} = ${table.scope} where ${table.scope} = $1`;
      const remove = `delete from ${table.qualified} where ${table.scope} = $1 and false`;
      const attempted = await refusal(
        forTenant({ tenantId: tenantA }).run(async (session) => {
          await session.query(touch, [tenantA]);
        }),
      );
      const removed = await refusal(
        forTenant({ tenantId: tenantA }).run(async (session) => {
          await session.query(remove, [tenantA]);
        }),
      );

      if (appendOnly) {
        expect(attempted, `${table.qualified} is append-only but accepted an update`).toMatch(
          /permission denied/i,
        );
        expect(removed, `${table.qualified} is append-only but accepted a delete`).toMatch(
          /permission denied/i,
        );
      } else {
        expect(attempted, `${table.qualified} refused an in-tenant update`).toBe('');
        expect(removed, `${table.qualified} refused an in-tenant delete`).toBe('');
      }
    });
  });
}

describe('V-DB rls-coverage is a check that can fail', () => {
  /**
   * B-05: a guardrail nobody has watched fail is a guardrail nobody knows works.
   * `rls_gap` is a real tenant-scoped table, created and dropped by the owner
   * inside this test, that declares no policy at all — exactly what a careless
   * later increment would add. Discovery must find it and the coverage check must
   * refuse it; if either stops being true, this test goes red before any real
   * table ever leaks.
   */
  test('rls-coverage — a tenant_id table with no forced RLS is discovered and refused', async () => {
    const created = await asRole(
      'vextrus_migrate',
      'create table public.rls_gap (id uuid primary key, tenant_id uuid not null)',
    );
    expect(created.error, `could not create the held-out probe: ${String(created.error)}`).toBeUndefined();
    try {
      const rediscovered = await discoverTenantTables();
      const gap = rediscovered.find((table) => table.name === 'rls_gap');
      expect(gap, 'discovery missed a table carrying tenant_id').toBeDefined();
      if (gap === undefined) return;

      const state = await rlsState(gap);
      expect(isCovered(state), 'the coverage check passed a table with no RLS').toBe(false);
    } finally {
      const dropped = await asRole('vextrus_migrate', 'drop table if exists public.rls_gap');
      expect(dropped.error, `the held-out probe was left behind: ${String(dropped.error)}`).toBeUndefined();
    }
  });
});

describe('V-DB composite-fk-backstop', () => {
  /**
   * The backstop SEAM-TENANT asks for. Policies are off inside `runAsSystem` —
   * that is what it is for — so the only thing standing between a system job and
   * a cross-tenant row is the composite foreign key `(tenant_id, row_id)`. This
   * is the test that says so out loud.
   */
  test('composite-fk-backstop — a ledger row cannot point at another tenant row, even under runAsSystem', async () => {
    const rowOfA = await forTenant({ tenantId: tenantA }).run(
      async (session) => (await session.query('select id from seam_probe_rows limit 1')).rows[0],
    );
    expect(rowOfA, 'the fixture row for tenant-a is missing').toBeDefined();

    const message = await refusal(
      runAsSystem('V-DB composite-fk-backstop').run(async (session) => {
        await session.query(
          'insert into seam_probe_ledger (id, tenant_id, row_id, note) values ($1, $2, $3, $4)',
          [crypto.randomUUID(), tenantB, String(rowOfA?.['id']), 'smuggled across tenants'],
        );
      }),
    );
    expect(message, 'the composite foreign key did not hold under runAsSystem').toMatch(
      /foreign key/i,
    );
  });

  test('composite-fk-backstop — the same insert is fine within one tenant', async () => {
    const written = await forTenant({ tenantId: tenantA }).run(async (session) => {
      const row = (await session.query('select id from seam_probe_rows limit 1')).rows[0];
      await session.query(
        'insert into seam_probe_ledger (id, tenant_id, row_id, note) values ($1, $2, $3, $4)' +
          ' on conflict (tenant_id, id) do nothing',
        [
          stableUuid(`in-tenant ledger entry ${tenantA}`),
          tenantA,
          String(row?.['id']),
          'in-tenant ledger entry',
        ],
      );
      return true;
    });
    expect(written).toBe(true);
  });
});

describe('V-DB role-split', () => {
  test('role-split — the three roles exist, none superuser, none bypassing RLS', async () => {
    const catalog = await asRole(
      'vextrus_migrate',
      'select rolname, rolsuper, rolbypassrls from pg_roles where rolname = any($1) order by rolname',
      [[...ROLES]],
    );
    expect(catalog.error).toBeUndefined();
    expect(catalog.rows.map((row) => String(row['rolname']))).toEqual([...ROLES].sort());
    for (const row of catalog.rows) {
      expect(row['rolsuper'], `${String(row['rolname'])} is a superuser`).toBe(false);
      expect(row['rolbypassrls'], `${String(row['rolname'])} bypasses RLS`).toBe(false);
    }
  });

  test('role-split — every role connects with its own dev password', async () => {
    for (const role of ROLES) {
      const probe = await asRole(role, 'select current_user as who');
      expect(probe.error, `${role} could not connect: ${String(probe.error)}`).toBeUndefined();
      expect(probe.rows[0]?.['who']).toBe(role);
    }
  });

  test('role-split — only vextrus_migrate owns app tables, and only it may create them', async () => {
    const owners = await asRole(
      'vextrus_migrate',
      `select c.relname, pg_get_userbyid(c.relowner) as owner
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r'
          and n.nspname not in ('pg_catalog', 'information_schema', 'drizzle')
          and n.nspname not like 'pg\\_%'`,
    );
    expect(owners.rows.length).toBeGreaterThan(0);
    for (const row of owners.rows) {
      expect(row['owner'], `${String(row['relname'])} is not owned by the migrate role`).toBe(
        'vextrus_migrate',
      );
    }

    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const attempt = await asRole(role, 'create table role_split_probe (id int primary key)');
      expect(attempt.error, `${role} was allowed to create a table`).toMatch(/permission denied/i);
    }
  });

  test('role-split — forTenant and runAsSystem connect only as vextrus_app', async () => {
    const scoped = await forTenant({ tenantId: tenantA }).run(
      async (session) => (await session.query('select current_user as who')).rows[0]?.['who'],
    );
    const system = await runAsSystem('V-DB role-split').run(
      async (session) => (await session.query('select current_user as who')).rows[0]?.['who'],
    );
    expect(scoped).toBe('vextrus_app');
    expect(system).toBe('vextrus_app');
  });

  test('role-split — the seam settings are transaction-local, not connection-wide', async () => {
    const inside = await forTenant({ tenantId: tenantA }).run(
      async (session) =>
        (await session.query(`select current_setting('app.tenant_id', true) as t`)).rows[0]?.['t'],
    );
    expect(inside).toBe(tenantA);

    // The pool hands the same connection back; a `SET` without `true` would leave
    // the last tenant's id on it, which is the leak nothing else here would catch.
    const after = await runAsSystem('V-DB transaction-local check').run(
      async (session) =>
        (await session.query(`select current_setting('app.tenant_id', true) as t`)).rows[0]?.['t'],
    );
    expect(after ?? '').toBe('');
  });
});

describe('V-DB migration-ledger', () => {
  test('migration-ledger — the applied migrations are recorded', async () => {
    const ledger = await asRole(
      'vextrus_migrate',
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    expect(ledger.error, `the ledger is unreadable: ${String(ledger.error)}`).toBeUndefined();
    expect(Number(ledger.rows[0]?.['n'] ?? 0)).toBeGreaterThan(0);
  });

  test('migration-ledger — the app and auth roles cannot read or rewrite it', async () => {
    for (const role of ['vextrus_app', 'vextrus_auth'] as const) {
      const read = await asRole(role, 'select * from drizzle.__drizzle_migrations');
      expect(read.error, `${role} can read the migration ledger`).toMatch(/permission denied/i);

      const forged = await asRole(
        role,
        `insert into drizzle.__drizzle_migrations (hash, created_at) values ('forged', 0)`,
      );
      expect(forged.error, `${role} can write the migration ledger`).toMatch(/permission denied/i);
    }
  });
});

describe('SEAM-TENANT the handles say what they are', () => {
  /**
   * The interface names this line verbatim, and it is the whole of the audit
   * trail `runAsSystem` leaves: an escalation nobody can see afterwards is an
   * escalation nobody reviews. Asserted here rather than described in a comment
   * (B-05), against a real transaction — the line is written when the work runs,
   * not when the handle is built.
   */
  test('runAsSystem logs SEAM-TENANT runAsSystem reason=<reason> to stderr', async () => {
    const written: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
    try {
      await runAsSystem('V-DB stderr audit line').run(async (session) => {
        await session.query('select 1');
      });
    } finally {
      stderr.mockRestore();
    }
    expect(written.join('')).toContain('SEAM-TENANT runAsSystem reason=V-DB stderr audit line\n');
  });

  /** The other named error message substring; TENANT_REQUIRED's counterpart. */
  for (const [label, reason] of [
    ['an empty reason', ''],
    ['a whitespace reason', '   '],
  ] as const) {
    test(`runAsSystem refuses ${label} with SYSTEM_REASON_REQUIRED`, () => {
      expect(() => runAsSystem(reason)).toThrow(/SYSTEM_REASON_REQUIRED/);
    });
  }

  /**
   * The session is the transaction's, not the caller's.
   *
   * It closes over a pooled client, and the pool hands that client to the next
   * `forTenant(...)` the moment this transaction releases it — so a session that
   * escaped `run` and kept querying would be issuing statements inside another
   * tenant's transaction, under that tenant's `app.tenant_id`. That is the
   * boundary SEAM-TENANT exists to hold, crossed where no policy can see it.
   */
  test('a session that escapes run is refused afterwards', async () => {
    const escaped = await forTenant({ tenantId: tenantA }).run(async (session) => session);
    const message = await refusal(escaped.query('select 1'));
    expect(message, 'the session still queried after its transaction committed').toMatch(
      /SESSION_CLOSED/,
    );
  });
});

describe('V-DB append-only is grants *and* trigger', () => {
  /**
   * Every append-only assertion elsewhere goes through `vextrus_app`, which the
   * missing grant stops before the trigger is ever reached — so the trigger, the
   * half that is supposed to hold for "everyone the grants do not already stop",
   * had never been observed to fire. The owner is exactly that everyone: it runs
   * every migration and holds every privilege.
   */
  for (const name of APPEND_ONLY_TABLES) {
    test(`append-only-grants — ${name} carries its trigger`, async () => {
      const found = await asRole(
        'vextrus_migrate',
        `select t.tgname
           from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1 and not t.tgisinternal`,
        [name],
      );
      expect(found.error).toBeUndefined();
      expect(found.rows.map((row) => String(row['tgname']))).toContain(`${name}_append_only`);
    });

    test(`append-only-grants — ${name} refuses the owner's update and delete`, async () => {
      const updated = await asRole('vextrus_migrate', `update public.${name} set note = note`);
      expect(updated.error, `${name} let the owner update it`).toMatch(
        /permission denied|append-only/i,
      );

      const deleted = await asRole('vextrus_migrate', `delete from public.${name}`);
      expect(deleted.error, `${name} let the owner delete from it`).toMatch(
        /permission denied|append-only/i,
      );
    });
  }
});
