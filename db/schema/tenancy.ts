/**
 * SEAM-TENANT's own ground: the tenant registry, and the two permanent probe
 * tables the live seam test proves itself against from day one.
 *
 * The probes are not scaffolding to be deleted later. V-DB asks for a mutable
 * table and an append-only one, joined by a composite tenant foreign key, so
 * that the seam has something to prove on a tree with no application tables in
 * it yet — and so that a regression in RLS, in the grants or in the composite-FK
 * backstop shows up as a red lane rather than as nothing at all.
 *
 * Every tenant-scoped table here follows one shape, because the live suite
 * discovers tables rather than being told about them (AC-02):
 *
 *   - a `tenant_id uuid not null` column — that column is what makes it
 *     discoverable, and what the policy keys on;
 *   - every other column defaulted or nullable, so `insert into t (tenant_id)
 *     values (...)` is a well-formed statement the database refuses on the
 *     policy rather than on the shape;
 *   - `tenantRls()` in the table's extras, which is what puts RLS on it.
 *
 * FORCE ROW LEVEL SECURITY, the grants and the append-only trigger are raw SQL
 * in the `0010_seam.sql` beside each migration's generated DDL: drizzle-kit
 * emits ENABLE but not FORCE, and an unforced policy is one the owner walks
 * straight past.
 */
import { sql } from 'drizzle-orm';
import { foreignKey, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The one predicate every tenant-scoped policy is built from.
 *
 * `current_setting(..., true)` is the missing-setting-safe form: on a connection
 * with no tenant it returns NULL, the comparison is NULL, and the row is neither
 * readable nor writable. `app.system = 'on'` is the `runAsSystem` escape, and it
 * is transaction-local at the seam, so it cannot be left switched on.
 */
export const TENANT_SCOPE = sql`tenant_id::text = current_setting('app.tenant_id', true) or current_setting('app.system', true) = 'on'`;

/**
 * The RLS policy builder every tenant-scoped table gets. One permissive policy
 * FOR ALL, with the same predicate in USING and WITH CHECK: reading another
 * tenant's row and writing one are the same refusal seen from two sides.
 */
export const tenantRls = (table: string) =>
  pgPolicy(`${table}_tenant`, {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: TENANT_SCOPE,
    withCheck: TENANT_SCOPE,
  });

/**
 * Tables the app role may append to and never rewrite. The migration turns this
 * list into grants (SELECT + INSERT, no UPDATE, no DELETE) and a trigger, and the
 * live suite reads it to know which tables to hold to the append-only fact.
 */
export const APPEND_ONLY_TABLES: readonly string[] = ['seam_probe_ledger'];

/**
 * The tenant registry. It carries no `tenant_id` of its own — it *is* the tenant
 * dimension — so it is not part of the discovered population, which is the one
 * thing that makes it look unprotected. It is not: it carries forced RLS of its
 * own shape, keyed on `id` rather than on `tenant_id`.
 *
 * The two halves are deliberately different, because reading and minting are
 * different acts:
 *
 *   - USING: a tenant may read its own row, and `runAsSystem` may read them all.
 *     Without this the registry is a list of every customer, readable through
 *     any `forTenant` handle.
 *   - WITH CHECK: `app.system = 'on'` and nothing else. A tenant comes into
 *     existence through `runAsSystem` or not at all — a scoped handle cannot
 *     mint one, not even its own.
 *
 * Referential integrity checks bypass row security, so the composite FKs from
 * the tenant-scoped tables still resolve against rows the writer cannot see.
 */
export const REGISTRY_READ = sql`id::text = current_setting('app.tenant_id', true) or current_setting('app.system', true) = 'on'`;
export const REGISTRY_WRITE = sql`current_setting('app.system', true) = 'on'`;

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('tenants_registry', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: REGISTRY_READ,
      withCheck: REGISTRY_WRITE,
    }),
    // FORCE subjects the owner to the policy too, and the owner is the role that
    // administers the registry (a migration that backfills a tenant, a fixture
    // teardown). Without a policy of its own its DELETE would match no rows and
    // report success — a cleanup that silently does nothing, which is worse than
    // one that is refused. So the exception is written down rather than left to
    // a role attribute: `vextrus_migrate` already owns the table and can drop it
    // outright, so this grants it nothing it did not have; `vextrus_app` — the
    // only role the seam ever connects as — is untouched by it.
    pgPolicy('tenants_owner', {
      as: 'permissive',
      for: 'all',
      to: 'vextrus_migrate',
      using: sql`true`,
      withCheck: sql`true`,
    }),
  ],
);

/** The mutable probe: rows a tenant may read, write, update and delete. */
export const seamProbeRows = pgTable(
  'seam_probe_rows',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    label: text('label'),
  },
  (table) => [
    // Tenant-first, so the composite foreign key below has something to point at.
    primaryKey({ columns: [table.tenantId, table.id] }),
    tenantRls('seam_probe_rows'),
  ],
);

/**
 * The append-only probe, joined to the mutable one by the composite tenant
 * foreign key that is SEAM-TENANT's backstop: a ledger line can only point at a
 * row of its own tenant, and the database says so even when the seam is running
 * as the system.
 */
export const seamProbeLedger = pgTable(
  'seam_probe_ledger',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    rowId: uuid('row_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    foreignKey({
      columns: [table.tenantId, table.rowId],
      foreignColumns: [seamProbeRows.tenantId, seamProbeRows.id],
      name: 'seam_probe_ledger_tenant_row_fk',
    }),
    tenantRls('seam_probe_ledger'),
  ],
);
