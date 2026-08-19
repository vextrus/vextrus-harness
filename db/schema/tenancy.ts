/**
 * The tenancy module: the tenant registry and the two permanent seam probes.
 *
 * layout-db — one schema per module, composed once in `db/schema/index.ts`.
 * Everything RLS-shaped is declared here, next to the table it guards, so a new
 * table cannot quietly arrive without a policy: the live suite discovers every
 * table carrying `tenant_id` and fails one that is not enabled AND forced.
 */
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The predicate every tenant-scoped policy keys on.
 *
 * `current_setting(..., true)` yields NULL when the setting was never made, and
 * `tenant_id::text = NULL` is NULL rather than true — so an unscoped connection
 * sees nothing and may write nothing. `app.system = 'on'` is the `runAsSystem`
 * escape, set transaction-locally by the seam and logged with its reason.
 */
export const TENANT_PREDICATE = sql`(
  "tenant_id"::text = current_setting('app.tenant_id', true)
  or current_setting('app.system', true) = 'on'
)`;

/** The same predicate for the tenant registry, whose own key is `id`. */
const TENANT_SELF_PREDICATE = sql`(
  "id"::text = current_setting('app.tenant_id', true)
  or current_setting('app.system', true) = 'on'
)`;

const SYSTEM_ONLY = sql`(current_setting('app.system', true) = 'on')`;

/**
 * The RLS policy builder every tenant-scoped table composes.
 *
 * It declares the policy; `ENABLE`/`FORCE ROW LEVEL SECURITY` are emitted beside
 * it in the migration SQL, because FORCE has no Drizzle declaration and an
 * un-forced table is one the owner walks straight past. The pair is checked
 * mechanically by the `rls-coverage` fact rather than trusted (B-05).
 */
export const tenantRls = (table: string) => [
  pgPolicy(`${table}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    using: TENANT_PREDICATE,
    withCheck: TENANT_PREDICATE,
  }),
];

/**
 * Tables the app role may only append to. The migration turns this list into
 * grants (SELECT + INSERT, no UPDATE/DELETE) and a refusing trigger, and the
 * live suite reads the same list back to check the grants it produced.
 */
export const APPEND_ONLY_TABLES: readonly string[] = ['seam_probe_ledger'];

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('tenants_tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: TENANT_SELF_PREDICATE,
      withCheck: SYSTEM_ONLY,
    }),
  ],
);

/** The mutable probe: something for `forTenant` to read, write and update. */
export const seamProbeRows = pgTable(
  'seam_probe_rows',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    label: text('label'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'seam_probe_rows_tenant_fk',
    }),
    ...tenantRls('seam_probe_rows'),
  ],
);

/**
 * The append-only probe. Its FK is composite on purpose: `(tenant_id, row_id)`
 * into `seam_probe_rows (tenant_id, id)` means a ledger line can never point at
 * another tenant's row — the backstop that still holds under `runAsSystem`,
 * where the policies have stepped aside.
 */
export const seamProbeLedger = pgTable(
  'seam_probe_ledger',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    rowId: uuid('row_id'),
    note: text('note'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id] }),
    foreignKey({
      columns: [table.tenantId, table.rowId],
      foreignColumns: [seamProbeRows.tenantId, seamProbeRows.id],
      name: 'seam_probe_ledger_row_fk',
    }),
    ...tenantRls('seam_probe_ledger'),
  ],
);
