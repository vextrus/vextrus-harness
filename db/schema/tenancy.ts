/**
 * Tenancy — the spine of SEAM-TENANT.
 *
 * Two things live here and nothing else: the tenant registry, and the two
 * permanent probe tables that give the seam something to prove from day one.
 * One mutable (`seam_probe_rows`), one append-only (`seam_probe_ledger`), joined
 * by a composite tenant FK so the database itself refuses a ledger row that
 * points across a tenant boundary — the backstop the policies alone cannot give.
 *
 * RLS is declared here, beside the table, because layout-db says so and because
 * a policy written down somewhere else is prose. What the schema cannot say in
 * Drizzle's vocabulary — FORCE ROW LEVEL SECURITY, the grants, the append-only
 * trigger — is raw SQL in `db/migrations/0000_init/0010_seam.sql`, and the
 * `rls-coverage` fact in the V-DB lane is what keeps the two honest.
 */
import { sql } from 'drizzle-orm';
import { foreignKey, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The predicate every tenant-scoped policy keys on.
 *
 * `current_setting(..., true)` returns NULL rather than erroring when the
 * setting was never set, so an unscoped connection reads NULL, the comparison is
 * NULL, and the row is invisible — the refusal is the absence of a decision, not
 * a special case somebody has to remember to write.
 */
const TENANT_SCOPE = `(tenant_id::text = current_setting('app.tenant_id', true)
      or current_setting('app.system', true) = 'on')`;

/**
 * The RLS declaration for one tenant-scoped table: visible to its own tenant,
 * writable only into its own tenant (WITH CHECK is what refuses a cross-tenant
 * write), and open to `runAsSystem` for the seed and the migration lanes.
 *
 * Enabling RLS follows from declaring a policy; *forcing* it — so the owner is
 * subject too — is `0010_seam.sql`, which drizzle-kit has no vocabulary for.
 */
export const tenantRls = (table: string) => [
  pgPolicy(`${table}_tenant_isolation`, {
    for: 'all',
    using: sql.raw(TENANT_SCOPE),
    withCheck: sql.raw(TENANT_SCOPE),
  }),
];

/** Tables the app role may append to and never rewrite. Grants follow this list. */
export const APPEND_ONLY_TABLES: readonly string[] = ['seam_probe_ledger'];

/**
 * The tenant registry. It carries no `tenant_id` of its own — it *is* the
 * tenants — so it is deliberately outside the population the V-DB lane
 * discovers. It still has forced RLS: a tenant may read itself, and only
 * `runAsSystem` may bring one into existence.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('tenants_self_or_system', {
      for: 'all',
      using: sql.raw(
        `(id::text = current_setting('app.tenant_id', true)
      or current_setting('app.system', true) = 'on')`,
      ),
      withCheck: sql.raw(`(current_setting('app.system', true) = 'on')`),
    }),
  ],
);

/**
 * The mutable probe. Primary key is `(tenant_id, id)` so a composite FK can
 * point at it: a child row naming a parent has to name the parent's tenant too,
 * which is what makes the tenant boundary a key constraint rather than a policy.
 */
export const seamProbeRows = pgTable(
  'seam_probe_rows',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    label: text('label'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), ...tenantRls('seam_probe_rows')],
);

/**
 * The append-only probe. `(tenant_id, row_id)` references `(tenant_id, id)` on
 * the mutable probe, so a ledger row belonging to tenant A can never point at a
 * row of tenant B — enforced even under `runAsSystem`, which policies are not.
 */
export const seamProbeLedger = pgTable(
  'seam_probe_ledger',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    rowId: uuid('row_id'),
    note: text('note'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'seam_probe_ledger_row_fk',
      columns: [t.tenantId, t.rowId],
      foreignColumns: [seamProbeRows.tenantId, seamProbeRows.id],
    }),
    ...tenantRls('seam_probe_ledger'),
  ],
);
