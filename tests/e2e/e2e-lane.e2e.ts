/**
 * V-E2E driven as a user of it: `pnpm e2e` on the command line, and the journey
 * inventory Playwright itself reports.
 *
 * The cheap half — the refusal paths and `--list` — needs neither a database nor
 * a browser and is where the argument contract (AC-03, AC-06, AC-10) is proved.
 * The live half builds the app, recreates the scratch database and drives
 * chromium; it is the Q-03 statement that J-000 is green.
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts tests/e2e/e2e-lane.e2e.ts
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { repoRoot, runCli } from '../acceptance/support/cli';

const LANE_TIMEOUT = 900_000;

const pnpm = (args: readonly string[], timeoutMs = 120_000) => runCli('pnpm', args, {}, timeoutMs);

/** One `pnpm e2e ...` invocation, with room for a production build in it. */
const lane = (args: readonly string[]) => pnpm(['e2e', ...args], LANE_TIMEOUT);

/** Every file under `var/e2e/artifacts/`, repo-relative. Empty when absent. */
function artifacts(): string[] {
  const root = join(repoRoot(), 'var', 'e2e', 'artifacts');
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else out.push(relative(repoRoot(), child));
    }
  };
  walk(root);
  return out;
}

const lines = (output: string): string[] => output.split('\n').map((line) => line.trim());

const indexOfLine = (output: string, needle: string): number =>
  lines(output).findIndex((line) => line.includes(needle));

describe('AC-06 --update-baselines refuses without a recorded reason', () => {
  test('exits 2, says --reason, and does so before building or touching the database', () => {
    const result = lane(['--update-baselines']);

    expect(result.status, `expected exit 2, got ${String(result.status)}:\n${result.output}`).toBe(
      2,
    );
    expect(result.output, 'the refusal never mentions --reason').toMatch(/--reason/);
    expect(
      indexOfLine(result.output, 'e2e: build'),
      `the refusal built the app first:\n${result.output}`,
    ).toBe(-1);
    expect(
      indexOfLine(result.output, 'vextrus_e2e_scratch'),
      `the refusal touched the scratch database first:\n${result.output}`,
    ).toBe(-1);
  }, 300_000);
});

describe('AC-03/AC-10 the journey inventory Playwright reports', () => {
  /** `playwright test --list --reporter=json`, parsed. */
  function list(args: readonly string[] = []): { raw: string; json: unknown } {
    const result = pnpm(['exec', 'playwright', 'test', '--list', '--reporter=json', ...args]);
    expect(
      result.status,
      `playwright --list failed (${String(result.status)}):\n${result.output}`,
    ).toBe(0);
    const start = result.stdout.indexOf('{');
    expect(start, `--list printed no JSON:\n${result.output}`).toBeGreaterThanOrEqual(0);
    return { raw: result.stdout.slice(start), json: JSON.parse(result.stdout.slice(start)) };
  }

  /** Every string under a `file` key, anywhere in the report. */
  function files(node: unknown, found: Set<string> = new Set()): Set<string> {
    if (Array.isArray(node)) {
      for (const item of node) files(item, found);
      return found;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'file' && typeof value === 'string') found.add(value);
        else files(value, found);
      }
    }
    return found;
  }

  test('AC-10 Playwright collects *.journey.ts and never the vitest *.e2e.ts files', () => {
    const collected = [...files(list().json)].filter((file) => file.endsWith('.ts'));

    expect(collected, 'Playwright collected no journey files at all').not.toHaveLength(0);
    for (const file of collected) {
      expect(file, `Playwright collected ${file}, which is not a *.journey.ts`).toMatch(
        /\.journey\.ts$/,
      );
    }
  });

  test('AC-03/AC-07/AC-08 the three journeys of this increment are registered by tag', () => {
    const { raw } = list();
    for (const id of ['@J-000', '@J-SELF', '@J-SELF-AXE-FAIL']) {
      expect(raw, `no test is tagged ${id}`).toContain(id);
    }
  });

  test('AC-03 --grep @J-000 selects J-000 and nothing else', () => {
    const selected = list(['--grep', '@J-000']);
    expect(selected.raw, 'nothing is tagged @J-000').toContain('@J-000');
    expect(
      selected.raw.includes('@J-SELF'),
      'selecting @J-000 also selected a J-SELF journey',
    ).toBe(false);
  });
});

describe('AC-01/AC-03/AC-04/AC-07/AC-08 the lane, live', () => {
  beforeAll(() => {
    // Cached after the first time; a failure here is reported by the lane runs
    // themselves, which say far more about what is missing than this line can.
    pnpm(['exec', 'playwright', 'install', 'chromium'], 600_000);
  }, 600_000);

  test(
    'AC-01/AC-03/AC-04 `pnpm e2e --journey J-000` is green, in stage order, on one build',
    () => {
      const result = lane(['--journey', 'J-000']);
      expect(result.status, `pnpm e2e --journey J-000 failed:\n${result.output}`).toBe(0);

      const stages = [
        'e2e: build',
        'e2e: scratch db vextrus_e2e_scratch ready',
        'e2e: seed',
        'e2e: web ready on 3211',
        'e2e: worker ready (noop) transport=fixture',
      ];
      let previous = -1;
      for (const stage of stages) {
        const at = indexOfLine(result.output, stage);
        expect(at, `the run never printed \`${stage}\`:\n${result.output}`).toBeGreaterThan(-1);
        expect(at, `\`${stage}\` came out of order:\n${result.output}`).toBeGreaterThan(previous);
        previous = at;
      }

      const builds = lines(result.output).filter((line) => line === 'e2e: build');
      expect(builds, `the app was built ${String(builds.length)} times in one invocation`)
        .toHaveLength(1);

      // AC-04: the checkpoint leaves its screenshot behind, under var/, gitignored.
      expect(
        artifacts().filter((file) => file.endsWith('.png')),
        `no checkpoint screenshot under var/e2e/artifacts:\n${artifacts().join('\n')}`,
      ).not.toHaveLength(0);

      const skipped = indexOfLine(result.output, 'baselines: skipped (non-linux)');
      if (process.platform === 'linux') {
        expect(skipped, 'the Linux run skipped the baseline compare').toBe(-1);
        expect(
          existsSync(join(repoRoot(), 'tests', 'e2e', 'baselines', 'J-000', 'home.png')),
          'J-000/home.png was not the baseline the Linux run compared against',
        ).toBe(true);
      } else {
        expect(skipped, `a non-linux run must say so:\n${result.output}`).toBeGreaterThan(-1);
      }
    },
    LANE_TIMEOUT,
  );

  test(
    'AC-07 the harness self-test journey J-SELF passes',
    () => {
      const result = lane(['--journey', 'J-SELF']);
      expect(result.status, `pnpm e2e --journey J-SELF failed:\n${result.output}`).toBe(0);
    },
    LANE_TIMEOUT,
  );

  test(
    'AC-08 the axe breaker journey fails, on purpose',
    () => {
      const result = lane(['--journey', 'J-SELF-AXE-FAIL']);

      // The failure has to be axe's, not the lane's: the run must get all the
      // way to a browser on 3211 and then go red.
      expect(
        indexOfLine(result.output, 'e2e: web ready on 3211'),
        `the breaker run never started the app:\n${result.output}`,
      ).toBeGreaterThan(-1);
      expect(
        result.status,
        `the axe breaker was green — a serious/critical violation went unreported:\n${result.output}`,
      ).not.toBe(0);
    },
    LANE_TIMEOUT,
  );
});

describe('AC-02 the seed runs every module, in order, against the named database', () => {
  test(
    'node scripts/seed.mjs seeds the fixture tenant and its probe rows',
    async () => {
      const migrated = pnpm(['db:migrate'], 300_000);
      expect(migrated.status, `pnpm db:migrate failed:\n${migrated.output}`).toBe(0);

      // The dev database of m0-02 is a migrated database with the probe tables
      // in it, which is all the seed contract asks of its target.
      const seeded = runCli(
        process.execPath,
        [join(repoRoot(), 'scripts', 'seed.mjs')],
        { VDB_PG_DATABASE: 'vextrus_dev' },
        300_000,
      );
      expect(seeded.status, `node scripts/seed.mjs failed:\n${seeded.output}`).toBe(0);

      const modules = readdirSync(join(repoRoot(), 'fixtures', 'e2e', 'seed'))
        .filter((file) => file.endsWith('.ts'))
        .sort();
      expect(modules, 'no seed modules to run').not.toHaveLength(0);

      const reported = lines(seeded.output)
        .filter((line) => /^seed: .* ok$/.test(line))
        .map((line) => line.replace(/^seed: /, '').replace(/ ok$/, ''));
      expect(
        reported,
        `the seed did not report every module in filename order:\n${seeded.output}`,
      ).toEqual(modules);

      const { asRole } = await import('./support/db-lane');
      const tenant = await asRole(
        'vextrus_migrate',
        `select slug, name from tenants where id = '00000000-0000-4000-8000-000000000e2e'`,
      );
      expect(tenant.error, `reading the seeded tenant failed: ${String(tenant.error)}`)
        .toBeUndefined();
      expect(tenant.rows, 'the fixture tenant was not seeded').toEqual([
        { slug: 'e2e', name: 'E2E Tenant' },
      ]);

      const probes = await asRole(
        'vextrus_migrate',
        `select (select count(*) from seam_probe_rows where tenant_id = '00000000-0000-4000-8000-000000000e2e') as rows,
                (select count(*) from seam_probe_ledger where tenant_id = '00000000-0000-4000-8000-000000000e2e') as ledger`,
      );
      expect(Number(probes.rows[0]?.['rows'] ?? 0), 'no probe row for the fixture tenant')
        .toBeGreaterThan(0);
      expect(Number(probes.rows[0]?.['ledger'] ?? 0), 'no ledger row for the fixture tenant')
        .toBeGreaterThan(0);
    },
    LANE_TIMEOUT,
  );
});
