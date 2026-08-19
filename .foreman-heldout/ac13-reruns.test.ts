/**
 * AC-13: the lane is re-runnable. The scratch database is dropped and recreated
 * every run (its oid changes), and the seed modules are idempotent.
 */
import { beforeAll, describe, expect, test } from 'vitest';

import { ensureBrowsers, lane, runCli, scratchOid } from './support';

describe('AC-13 running the lane twice', () => {
  beforeAll(() => {
    ensureBrowsers();
  });

  test('two back-to-back J-000 runs are both green, on a freshly created database each time', async () => {
    const first = lane(['--journey', 'J-000']);
    expect(first.status, `the first pnpm e2e --journey J-000 failed:\n${first.output}`).toBe(0);
    const firstOid = await scratchOid();
    expect(firstOid, 'no scratch database exists after a run of the lane').toBeDefined();

    const second = lane(['--journey', 'J-000']);
    expect(second.status, `the second pnpm e2e --journey J-000 failed:\n${second.output}`).toBe(0);
    const secondOid = await scratchOid();

    expect(
      secondOid,
      'the scratch database survived the second run — it is created if missing, not recreated',
    ).not.toStrictEqual(firstOid);
  });

  test('node scripts/seed.mjs is idempotent against an already-seeded database', () => {
    const first = runCli(process.execPath, ['scripts/seed.mjs'], {}, 300_000);
    expect(first.status, `the first node scripts/seed.mjs failed:\n${first.output}`).toBe(0);

    const second = runCli(process.execPath, ['scripts/seed.mjs'], {}, 300_000);
    expect(
      second.status,
      `re-seeding an already-seeded database failed:\n${second.output}`,
    ).toBe(0);
  });
});
