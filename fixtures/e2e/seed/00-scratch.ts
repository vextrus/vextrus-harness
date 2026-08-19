/**
 * The e2e fixture world, as far as the schema of today can hold it.
 *
 * V-E2E asks for "the e2e fixture tenant/users/project". Only `tenants` and the
 * two SEAM-TENANT probe tables exist in M0, so this module persists what the
 * database can hold — the tenant and one row in each probe table — and exports
 * the users and the project as constants, so the increment that lands those
 * tables seeds them from the same names rather than inventing a second fixture.
 *
 * Idempotent: the lane recreates its scratch database every run, but this same
 * module also runs against a long-lived dev database, where a second run must
 * change nothing. `seam_probe_ledger` is append-only (grants + trigger), so
 * "already there" has to be expressed as ON CONFLICT DO NOTHING and never as a
 * delete-then-insert.
 */
import type { Client } from 'pg';

export const E2E_TENANT = {
  id: '00000000-0000-4000-8000-000000000e2e',
  slug: 'e2e',
  name: 'E2E Tenant',
} as const;

/** The people the journeys sign in as, once there is an auth lane to sign into. */
export const E2E_USERS = [
  { email: 'owner@e2e.vextrus.test', name: 'E2E Owner', role: 'owner' },
] as const;

/** J-000's project, once there is a projects table to put it in. */
export const E2E_PROJECT = { name: 'E2E Project', slug: 'e2e-project' } as const;

/** Fixed ids: a re-run must collide with itself rather than pile up rows. */
const PROBE_ROW_ID = '00000000-0000-4000-8000-0000000e2e01';
const PROBE_LEDGER_ID = '00000000-0000-4000-8000-0000000e2e02';

export default async function seed({ client }: { client: Client }): Promise<void> {
  await client.query(
    `insert into tenants (id, slug, name) values ($1, $2, $3)
       on conflict (id) do update set slug = excluded.slug, name = excluded.name`,
    [E2E_TENANT.id, E2E_TENANT.slug, E2E_TENANT.name],
  );

  await client.query(
    `insert into seam_probe_rows (id, tenant_id, label) values ($1, $2, $3)
       on conflict on constraint seam_probe_rows_pkey do nothing`,
    [PROBE_ROW_ID, E2E_TENANT.id, 'e2e fixture row'],
  );

  await client.query(
    `insert into seam_probe_ledger (id, tenant_id, row_id, note) values ($1, $2, $3, $4)
       on conflict on constraint seam_probe_ledger_pkey do nothing`,
    [PROBE_LEDGER_ID, E2E_TENANT.id, PROBE_ROW_ID, 'e2e fixture ledger entry'],
  );
}
