/**
 * Journey: discovery covers every relation that carries a tenant, not just the
 * plain ones.
 *
 * AC-02's promise is "zero test edits when later increments add tables", and
 * V-DB's rls-coverage fact is supposed to make an unprotected tenant table fail
 * *by construction*. Both promises are only as wide as the catalog query behind
 * them. A partitioned table is one tenant table declared across several catalog
 * rows: the parent (`relkind = 'p'`) is what queries and policies address, the
 * partitions (`relkind = 'r'`) are where the rows live, and RLS on a partition
 * does not apply to a query routed through the parent.
 *
 * So a population built from `relkind = 'r'` alone finds the partitions and
 * never the parent — and a partitioned tenant table whose parent has no policy
 * passes every per-table fact while reading straight across tenants through
 * that parent. This checkpoint holds discovery to the whole relation.
 *
 * The probe is created and dropped as `vextrus_migrate` inside the test, the
 * way the held-out `rls_gap` probe is: nothing it makes outlives it.
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  asRole,
  connectBootstrap,
  discoverTenantTables,
  lit,
  loadSeam,
  pnpm,
  runSql,
  seedFixtures,
  withHandle,
  type SeamFixtures,
  type SeamModule,
} from './support/db-lane';

let seam: SeamModule;
let fixtures: SeamFixtures;

const PARENT = 'breaker_part_probe';

/** Drops the probe whatever happened, so a red run leaves no table behind. */
const dropProbe = (): Promise<void> =>
  asRole('vextrus_migrate', async (client) => {
    await client.query(`drop table if exists ${PARENT} cascade`);
  });

beforeAll(async () => {
  const migrated = pnpm(['db:migrate']);
  expect(migrated.status, `pnpm db:migrate must succeed:\n${migrated.output}`).toBe(0);

  seam = await loadSeam();
  fixtures = await seedFixtures();
  await dropProbe();
}, 300_000);

afterAll(dropProbe);

describe('AC-02 / V-DB — rls-coverage sees a partitioned tenant table', () => {
  test('a partitioned tenant table with an unprotected parent is discovered and leaks', async () => {
    const scope = `tenant_id::text = current_setting('app.tenant_id', true) or current_setting('app.system', true) = 'on'`;

    // A tenant table added the way a later increment would add a large one:
    // partitioned, with every *partition* protected exactly as the schema
    // helper protects a plain table. Only the parent is left bare — which is
    // the mistake rls-coverage exists to catch.
    await asRole('vextrus_migrate', async (client) => {
      await client.query(
        `create table ${PARENT} (
           id uuid not null default gen_random_uuid(),
           tenant_id uuid not null,
           secret text,
           primary key (tenant_id, id)
         ) partition by hash (tenant_id)`,
      );
      await client.query(
        `create table ${PARENT}_0 partition of ${PARENT} for values with (modulus 1, remainder 0)`,
      );
      await client.query(`alter table ${PARENT}_0 enable row level security`);
      await client.query(`alter table ${PARENT}_0 force row level security`);
      await client.query(
        `create policy ${PARENT}_0_tenant on ${PARENT}_0 as permissive for all to public using (${scope}) with check (${scope})`,
      );
      await client.query(`grant select, insert on ${PARENT}, ${PARENT}_0 to vextrus_app`);
      await client.query(
        `insert into ${PARENT} (tenant_id, secret)
         values (${lit(fixtures.tenantA)}, 'A-secret'), (${lit(fixtures.tenantB)}, 'B-secret')`,
      );
    });

    const client = await connectBootstrap();
    let discovered: string[];
    try {
      discovered = (await discoverTenantTables(client)).map((table) => table.name);
    } finally {
      await client.end();
    }

    expect(
      discovered,
      `the partitioned parent carries tenant_id and is what queries address, so it must be in the population — saw [${discovered.join(', ')}]`,
    ).toContain(PARENT);

    // The leak the missing coverage lets through, stated as itself: whatever the
    // population turns out to be, reading the parent as one tenant must not
    // return another tenant's row.
    const rows = await withHandle(seam.forTenant({ tenantId: fixtures.tenantA }), (tx) =>
      runSql(tx, `select tenant_id::text as tenant_id from ${PARENT}`),
    );
    expect(
      rows.map((row) => String(row['tenant_id'])).filter((id) => id !== fixtures.tenantA),
      'forTenant(A) reading through the partitioned parent must not see another tenant’s rows',
    ).toEqual([]);
  });
});
