/**
 * SEAM-TENANT's schema: the tenant registry, the two permanent probe tables the
 * live seam suite proves itself against, and the helpers every later module
 * composes (layout-db — one schema per module, composed once in the barrel).
 *
 * The probes are not fixtures. They are permanent tables whose only job is to
 * give V-DB something to prove from day one: `seam_probe_rows` is the mutable
 * shape, `seam_probe_ledger` the append-only one, joined by the composite tenant
 * foreign key that is the backstop when a policy is missing.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  foreignKey,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The predicate every tenant-scoped policy is keyed on.
 *
 * `nullif(..., '')` because an exported-but-empty setting is the ordinary
 * accident and `''::uuid` is an error, not a refusal — a policy that errors on a
 * blank setting would read as a database fault instead of as RLS doing its job.
 * `current_setting(..., true)` returns NULL when the setting was never set, so an
 * unscoped connection compares against NULL and sees nothing.
 *
 * The `app.system` arm is `runAsSystem`: bounded, logged, and never a bypass of
 * the composite foreign keys, which is why those are declared as well.
 */
export const tenantPredicate = (column: string): SQL =>
  sql.raw(
    `(${column} = nullif(current_setting('app.tenant_id', true), '')::uuid` +
      ` or current_setting('app.system', true) = 'on')`,
  );

/**
 * The RLS policy builder: one permissive policy for every command, `USING` and
 * `WITH CHECK` the same predicate, so a read that cannot see a row cannot write
 * it either. Declared here (stack-postgres: RLS declared in schema) and *forced*
 * in the migration — `ENABLE ROW LEVEL SECURITY` alone leaves the owning role
 * exempt, and the owner is exactly who runs a migration.
 */
export const tenantRls = (policyName: string, column = 'tenant_id') =>
  pgPolicy(policyName, {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: tenantPredicate(column),
    withCheck: tenantPredicate(column),
  });

/**
 * Tables the app role may only append to. The migration turns each name here
 * into grants (SELECT + INSERT, no UPDATE, no DELETE) and a trigger, so the
 * refusal holds for the owner too; the seam suite reads this list back and
 * proves the refusal per table.
 */
export const APPEND_ONLY_TABLES: readonly string[] = ['seam_probe_ledger'];

/** The tenant registry. Carries no `tenant_id`: it *is* the tenant. */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tenants_slug_key').on(table.slug),
    // Scoped on `id` rather than `tenant_id`: a tenant may see itself, and
    // `runAsSystem` (registration, migration) may see them all.
    tenantRls('tenants_tenant_isolation', 'id'),
  ],
).enableRLS();

/** The mutable probe: the ordinary tenant-scoped table shape. */
export const seamProbeRows = pgTable(
  'seam_probe_rows',
  {
    id: uuid('id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Tenant-first, so the composite foreign key below has a key to point at.
    primaryKey({ name: 'seam_probe_rows_pkey', columns: [table.tenantId, table.id] }),
    foreignKey({
      name: 'seam_probe_rows_tenant_id_fkey',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }),
    tenantRls('seam_probe_rows_tenant_isolation'),
  ],
).enableRLS();

/**
 * The append-only probe. Its foreign key is composite — `(tenant_id, row_id)`,
 * not `row_id` — so a row can only ever point at a row of its own tenant. That
 * is the backstop SEAM-TENANT asks for: it holds under `runAsSystem`, where the
 * policies do not.
 */
export const seamProbeLedger = pgTable(
  'seam_probe_ledger',
  {
    id: uuid('id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    rowId: uuid('row_id').notNull(),
    note: text('note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'seam_probe_ledger_pkey', columns: [table.tenantId, table.id] }),
    foreignKey({
      name: 'seam_probe_ledger_row_fkey',
      columns: [table.tenantId, table.rowId],
      foreignColumns: [seamProbeRows.tenantId, seamProbeRows.id],
    }),
    tenantRls('seam_probe_ledger_tenant_isolation'),
  ],
).enableRLS();
