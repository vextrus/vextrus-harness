/**
 * Journey: the tenant registry is inside the seam, not beside it.
 *
 * R-SPINE-004 / SEAM-TENANT, settled reading: `tenants` carries no `tenant_id`,
 * so it is deliberately outside the *discovered* population — and that is
 * precisely why nothing in the discovering suite covers it. The settled reading
 * spells out what has to hold in its place:
 *
 *   > `tenants` … still has forced RLS: a tenant may read its own row, and
 *   > WITH CHECK requires app.system = 'on', so only runAsSystem may bring a
 *   > tenant into existence.
 *
 * Those two sentences are the whole of this file. The discovering suite cannot
 * make them, because it never sees the table; the register of who the tenants
 * are is the one table where "outside the population" must not mean "outside
 * the seam".
 *
 * Run with:
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  asRole,
  connectBootstrap,
  count,
  isRlsRefusal,
  lit,
  loadSeam,
  pnpm,
  refusal,
  runSql,
  scalar,
  seedFixtures,
  uuid,
  withHandle,
  type SeamFixtures,
  type SeamModule,
} from './support/db-lane';

let seam: SeamModule;
let fixtures: SeamFixtures;

/** Slugs this file mints, so its own leavings never outlive the run. */
const MINTED = ['breaker-registry-mint-scoped', 'breaker-registry-mint-unscoped'];

beforeAll(async () => {
  const migrated = pnpm(['db:migrate']);
  expect(migrated.status, `pnpm db:migrate must succeed:\n${migrated.output}`).toBe(0);

  seam = await loadSeam();
  fixtures = await seedFixtures();
}, 300_000);

afterAll(async () => {
  // The owner is the only role that may delete a tenant, which is itself the point.
  await asRole('vextrus_migrate', async (client) => {
    await client.query(`delete from tenants where slug in (${MINTED.map(lit).join(', ')})`);
  });
});

describe('SEAM-TENANT — the tenant registry is under the seam', () => {
  test('tenants has row level security enabled AND forced', async () => {
    const client = await connectBootstrap();
    try {
      const rows = await runSql(
        client,
        `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'tenants'`,
      );
      expect(rows.length, 'the tenants table must exist after db:migrate').toBe(1);
      expect(scalar(rows, 'enabled'), 'tenants: RLS must be enabled').toBe(true);
      expect(
        scalar(rows, 'forced'),
        'tenants: RLS must be FORCED — the migrate role owns it, and an unforced policy is one the owner walks past',
      ).toBe(true);
    } finally {
      await client.end();
    }
  });

  test('forTenant(A) sees its own tenant row and no other tenant’s', async () => {
    const rows = await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
      runSql(tx, 'select id::text as id from tenants'),
    );
    const ids = rows.map((row) => String(row['id']));
    expect(ids, 'a tenant must be able to read its own registry row').toContain(fixtures.tenantA);
    expect(
      ids.filter((id) => id !== fixtures.tenantA),
      'forTenant(A) must not be able to enumerate the other tenants of the installation',
    ).toEqual([]);
  });

  test('an unscoped app connection reads no tenant rows at all', async () => {
    const rows = await asRole('vextrus_app', (client) =>
      runSql(client, 'select count(*)::int as count from tenants'),
    );
    expect(
      count(rows),
      'a vextrus_app connection with no tenant setting must read zero registry rows',
    ).toBe(0);
  });

  test('only runAsSystem may bring a tenant into existence', async () => {
    const throughTenant = await refusal(() =>
      withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
        runSql(
          tx,
          `insert into tenants (id, slug, name)
           values (${lit(uuid())}, ${lit(MINTED[0] ?? '')}, ${lit('minted by a tenant')})`,
        ),
      ),
    );
    expect(
      throughTenant.refused,
      'forTenant must not be able to mint a tenant — WITH CHECK requires app.system',
    ).toBe(true);
    expect(isRlsRefusal(throughTenant), throughTenant.message).toBe(true);

    const unscoped = await asRole('vextrus_app', (client) =>
      refusal(() =>
        client.query(
          `insert into tenants (id, slug, name)
           values (${lit(uuid())}, ${lit(MINTED[1] ?? '')}, ${lit('minted unscoped')})`,
        ),
      ),
    );
    expect(unscoped.refused, 'an unscoped app connection must not be able to mint a tenant').toBe(
      true,
    );
    expect(isRlsRefusal(unscoped), unscoped.message).toBe(true);

    // And the escape still works, or the registry would be unwritable.
    const asSystem = await refusal(() =>
      withHandle(seam.runAsSystem('acceptance: registry is writable through the escape'), (tx) =>
        runSql(
          tx,
          `insert into tenants (id, slug, name)
           values (${lit(uuid())}, ${lit(MINTED[0] ?? '')}, ${lit('minted by the system seam')})`,
        ),
      ),
    );
    expect(asSystem.refused, `runAsSystem must still be able to mint a tenant: ${asSystem.message}`).toBe(
      false,
    );
  });
});
