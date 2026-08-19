/**
 * V-E2E, read off the tree: the parts of the lane that are true (or false)
 * before anything is started — the scripts contract, the Playwright wiring, the
 * committed baselines and the CI workflow that runs the lane on every PR.
 *
 * Nothing here starts a server or a database; the live lane is
 * tests/e2e/e2e-lane.e2e.ts. These are in `pnpm test` (and therefore in
 * `pnpm verify`), so they stay file reads.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';

const repoRoot = process.env['FOREMAN_REPO_ROOT'] ?? process.cwd();

const read = (relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), 'utf8');

const exists = (relativePath: string): boolean => existsSync(join(repoRoot, relativePath));

/**
 * Imports a module of the tree by path rather than by specifier: these modules
 * do not exist yet, and a missing *specifier* is a compile error in this file,
 * where a missing *file* is the failing assertion this test is here to make.
 */
async function importFromRepo(relativePath: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(join(repoRoot, relativePath)).href;
  const loaded: unknown = await import(/* @vite-ignore */ url);
  return loaded as Record<string, unknown>;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const packageJson = (): PackageJson => JSON.parse(read('package.json')) as PackageJson;

/** Every file under `dir`, repo-relative, recursively. Empty when `dir` is absent. */
function walk(relativeDir: string): string[] {
  const absolute = join(repoRoot, relativeDir);
  if (!existsSync(absolute)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) out.push(...walk(relative(repoRoot, child)));
    else out.push(relative(repoRoot, child));
  }
  return out;
}

/** PNG magic bytes — a committed baseline has to be a real image, not a placeholder. */
function isPng(relativePath: string): boolean {
  const buffer = readFileSync(join(repoRoot, relativePath));
  return (
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

/** An export of `name`, however it is spelled: function, const, or a re-export list. */
function exportsSymbol(source: string, name: string): boolean {
  const declaration = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|let|class|type|interface)\\s+${name}\\b`,
  );
  const list = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, 's');
  return declaration.test(source) || list.test(source);
}

describe('AC-01/AC-02 the lane has entry points', () => {
  test('AC-01 package.json runs the lane through scripts/e2e.mjs', () => {
    expect(packageJson().scripts?.['e2e']).toBe('node scripts/e2e.mjs');
    expect(exists('scripts/e2e.mjs'), 'scripts/e2e.mjs is missing').toBe(true);
  });

  test('AC-02 package.json runs the seed through scripts/seed.mjs', () => {
    expect(packageJson().scripts?.['seed']).toBe('node scripts/seed.mjs');
    expect(exists('scripts/seed.mjs'), 'scripts/seed.mjs is missing').toBe(true);
  });

  test('AC-02 the e2e seed directory holds ordered TypeScript modules', () => {
    const seeds = walk('fixtures/e2e/seed').filter((file) => file.endsWith('.ts'));
    expect(seeds, 'no seed modules under fixtures/e2e/seed/').not.toHaveLength(0);
    expect(seeds).toContain(join('fixtures', 'e2e', 'seed', '00-scratch.ts'));
  });

  test('AC-01 the two declared dependencies are pinned exactly, like every other pin', () => {
    const dev = packageJson().devDependencies ?? {};
    for (const name of ['@playwright/test', '@axe-core/playwright']) {
      const pin = dev[name];
      expect(pin, `${name} is not in devDependencies`).toBeDefined();
      expect(pin, `${name} is pinned as "${String(pin)}" — ranges are not pins`).toMatch(
        /^\d+\.\d+\.\d+/,
      );
    }
  });
});

describe('AC-02 the fixture constants later increments will build on', () => {
  test('00-scratch exports E2E_TENANT, E2E_USERS and E2E_PROJECT', async () => {
    const seed = await importFromRepo('fixtures/e2e/seed/00-scratch.ts');

    expect(seed['E2E_TENANT']).toEqual({
      id: '00000000-0000-4000-8000-000000000e2e',
      slug: 'e2e',
      name: 'E2E Tenant',
    });

    const users = seed['E2E_USERS'];
    expect(Array.isArray(users), 'E2E_USERS is not an array').toBe(true);
    expect(users).toContainEqual(
      expect.objectContaining({ email: 'owner@e2e.vextrus.test', name: 'E2E Owner' }),
    );

    expect(seed['E2E_PROJECT']).toEqual(expect.objectContaining({ name: 'E2E Project' }));
    expect(typeof seed['default'], 'the module must default-export its seed function').toBe(
      'function',
    );
  });
});

describe('AC-04/AC-07/AC-10 the harness surface', () => {
  test('AC-10 tests/e2e/harness/index.ts exports the four contract helpers', () => {
    const source = read('tests/e2e/harness/index.ts');
    for (const name of ['journey', 'checkpoint', 'readMail', 'waitForMail']) {
      expect(exportsSymbol(source, name), `harness does not export ${name}`).toBe(true);
    }
  });

  test('AC-10 journey() knows the @breaker tag breakers are excluded by', () => {
    // The @<id> tag itself is proved by `playwright test --list --grep`, live,
    // in tests/e2e/e2e-lane.e2e.ts: how the string is built is the Builder's.
    expect(read('tests/e2e/harness/index.ts'), 'journey() never applies an @breaker tag').toMatch(
      /@breaker/,
    );
  });

  test('AC-04 checkpoint enforces the axe and baseline thresholds the Bible names', () => {
    // The screenshot options may be defaulted in playwright.config.ts instead of
    // spelled at the call site, so both files count as one surface here.
    const source = `${read('tests/e2e/harness/index.ts')}\n${read('playwright.config.ts')}`;
    expect(source, 'checkpoint does not mention the serious impact level').toMatch(/serious/);
    expect(source, 'checkpoint does not mention the critical impact level').toMatch(/critical/);
    expect(source, 'checkpoint does not use toHaveScreenshot').toMatch(/toHaveScreenshot/);
    expect(source, 'maxDiffPixelRatio 0.002 is not applied at the checkpoint').toMatch(
      /maxDiffPixelRatio/,
    );
    expect(source, 'the non-linux skip line is not printed').toMatch(
      /baselines: skipped \(non-linux\)/,
    );
    expect(source, 'checkpoint does not write under var/e2e/artifacts').toMatch(
      /var\/e2e\/artifacts|artifacts/,
    );
  });

  test('AC-04/AC-07 journeyMasks is a registry with a non-empty J-SELF entry', async () => {
    const masks = await importFromRepo('tests/e2e/harness/masks.ts');
    const registry = masks['journeyMasks'];
    expect(registry, 'masks.ts does not export journeyMasks').toBeDefined();

    const table = registry as Record<string, string[]>;
    for (const [journeyId, selectors] of Object.entries(table)) {
      expect(Array.isArray(selectors), `journeyMasks[${journeyId}] is not an array`).toBe(true);
      for (const selector of selectors) expect(typeof selector).toBe('string');
    }
    expect(table['J-SELF'], 'J-SELF has no mask entry').toBeDefined();
    expect(table['J-SELF'] ?? [], 'the J-SELF mask entry is empty').not.toHaveLength(0);
  });

  test('AC-01 the worker entry exists as its own module', () => {
    expect(exists('tests/e2e/harness/worker.mjs'), 'tests/e2e/harness/worker.mjs is missing').toBe(
      true,
    );
  });
});

const UPDATES_LOG = 'tests/e2e/baselines/UPDATES.md';

describe('AC-05 committed Linux baselines', () => {
  test('playwright.config.ts routes snapshots to tests/e2e/baselines/<journeyId>/', () => {
    const config = read('playwright.config.ts');
    expect(config, 'no snapshotPathTemplate in playwright.config.ts').toMatch(
      /snapshotPathTemplate/,
    );
    expect(config, 'snapshots are not routed under tests/e2e/baselines').toMatch(
      /tests\/e2e\/baselines/,
    );
  });

  test('J-000/home.png and a J-SELF checkpoint are committed PNGs', () => {
    const home = join('tests', 'e2e', 'baselines', 'J-000', 'home.png');
    expect(exists(home), `${home} is not committed`).toBe(true);
    expect(isPng(home), `${home} is not a PNG`).toBe(true);

    const selfBaselines = walk(join('tests', 'e2e', 'baselines', 'J-SELF')).filter((file) =>
      file.endsWith('.png'),
    );
    expect(selfBaselines, 'no committed baseline for the J-SELF checkpoint').not.toHaveLength(0);
    for (const file of selfBaselines) expect(isPng(file), `${file} is not a PNG`).toBe(true);
  });

  test('only Linux baselines are in the tree', () => {
    const committed = walk(join('tests', 'e2e', 'baselines')).filter((file) =>
      file.endsWith('.png'),
    );
    expect(committed, 'there are no committed baselines at all').not.toHaveLength(0);

    const foreign = committed.filter((file) => /-(darwin|win32)/.test(file));
    expect(foreign, `non-Linux baselines are committed: ${foreign.join(', ')}`).toHaveLength(0);
  });

  test('AC-06 the baseline update log exists to be appended to', () => {
    expect(
      exists(join('tests', 'e2e', 'baselines', 'UPDATES.md')),
      'tests/e2e/baselines/UPDATES.md is missing',
    ).toBe(true);
  });

  /**
   * Regression guard (Q-06), added after arbitration: baselines under
   * tests/e2e/baselines/** belong to this increment, so writing them is allowed
   * — what is not allowed is writing them silently. Every branch that adds or
   * rewrites a baseline PNG must also append its recorded reason to UPDATES.md.
   * This passes today (both baseline commits recorded a reason) and must keep
   * passing.
   */
  test('a baseline PNG never changes on the branch without a recorded reason', () => {
    const git = (args: string[]): string => {
      const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
      return result.status === 0 ? (result.stdout ?? '') : '';
    };
    const base = git(['merge-base', 'HEAD', 'main']).trim();
    if (!base) return; // no main to compare against (shallow checkout): nothing to judge

    const changed = git(['diff', '--name-only', `${base}..HEAD`, '--', 'tests/e2e/baselines'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const pngs = changed.filter((file) => file.endsWith('.png'));
    if (pngs.length === 0) return; // no baseline moved: the rule has nothing to say

    const appended = git(['diff', '--unified=0', `${base}..HEAD`, '--', UPDATES_LOG])
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1).trim())
      .filter(Boolean);
    expect(
      appended.length,
      `baselines changed on this branch (${pngs.join(', ')}) but no reason was appended to ${UPDATES_LOG}`,
    ).toBeGreaterThan(0);
  });
});

describe('AC-10 Playwright and vitest do not collide', () => {
  test('Playwright only ever matches *.journey.ts', () => {
    const config = read('playwright.config.ts');
    // That it matches *only* those files is proved live by `--list` in
    // tests/e2e/e2e-lane.e2e.ts; here it is only that the suffix is the contract's.
    expect(config, 'playwright.config.ts does not restrict testMatch to *.journey.ts').toMatch(
      /journey\.ts/,
    );
  });

  // Regression guard: this one passes today and must keep passing — the point
  // of AC-10 is that adding Playwright takes nothing away from `pnpm test`.
  test('the vitest acceptance journeys of earlier increments are still there', () => {
    for (const file of [
      'tests/e2e/verify-green.e2e.ts',
      'tests/e2e/scaffold-home.e2e.ts',
      'tests/e2e/db-lane.e2e.ts',
      'tests/e2e/db-lane-breaker.e2e.ts',
    ]) {
      expect(exists(file), `${file} was removed`).toBe(true);
    }
    expect(read('vitest.config.ts'), '`pnpm test` no longer excludes *.e2e.ts').toMatch(
      /\*\.e2e\.ts/,
    );
  });

  test('the page-object convention is documented', () => {
    expect(exists('tests/e2e/pages/README.md'), 'tests/e2e/pages/README.md is missing').toBe(true);
  });
});

describe('AC-04 run artifacts are scratch, not tree', () => {
  test('var/e2e/artifacts is gitignored', () => {
    const probe = join('var', 'e2e', 'artifacts', 'trace.zip');
    const result = spawnSync('git', ['check-ignore', '-q', probe], { cwd: repoRoot });
    expect(result.status, `git does not ignore ${probe}`).toBe(0);
  });
});

/** `jobs:` split into `{ name -> body }` by indentation — enough YAML for AC-09. */
function workflowJobs(source: string): Record<string, string> {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start < 0) return {};
  const jobs: Record<string, string> = {};
  let current: string | undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const header = /^ {2}["']?([\w:.\-]+)["']?:\s*$/.exec(line);
    if (header?.[1] !== undefined) {
      current = header[1];
      jobs[current] = '';
      continue;
    }
    if (current !== undefined) jobs[current] += `${line}\n`;
  }
  return jobs;
}

describe('AC-09 the lane runs in CI on every PR', () => {
  const workflow = (): string => read(join('.github', 'workflows', 'ci.yml'));

  test('the workflow exists and triggers on pull_request and on the default branch', () => {
    expect(exists(join('.github', 'workflows', 'ci.yml')), '.github/workflows/ci.yml is missing')
      .toBe(true);
    const source = workflow();
    expect(source, 'no pull_request trigger').toMatch(/pull_request/);
    expect(source, 'no push trigger for the default branch').toMatch(/push:/);
    expect(source, 'the default branch is not named in the push trigger').toMatch(/\bmain\b/);
  });

  test('the three jobs exist in the verify -> test:db -> e2e order', () => {
    const jobs = workflowJobs(workflow());
    expect(Object.keys(jobs).sort()).toEqual(['e2e', 'test:db', 'verify']);
    expect(jobs['test:db'] ?? '', 'test:db does not need verify').toMatch(
      /needs:\s*\[?\s*["']?verify/,
    );
    expect(jobs['e2e'] ?? '', 'e2e does not need test:db').toMatch(/needs:\s*\[?\s*["']?test:db/);
    for (const [name, body] of Object.entries(jobs)) {
      expect(body, `${name} does not run on ubuntu-latest`).toMatch(/runs-on:\s*ubuntu-latest/);
    }
  });

  test('a postgres:16 service is published on the contract port 5544', () => {
    const source = workflow();
    expect(source, 'no postgres:16 service image').toMatch(/postgres:16/);
    expect(source, 'the postgres service is not published on host port 5544').toMatch(
      /5544:5432/,
    );
  });

  test('the toolchain is corepack pnpm plus uv', () => {
    const source = workflow();
    expect(source, 'pnpm is not activated through corepack').toMatch(/corepack enable/);
    expect(source, 'uv is not installed').toMatch(/uv/i);
  });

  test('the e2e job installs chromium, sets the fixture transport and always uploads artifacts', () => {
    const e2e = workflowJobs(workflow())['e2e'] ?? '';
    expect(e2e, 'chromium is not installed with its system deps').toMatch(
      /playwright install --with-deps chromium/,
    );
    expect(e2e, 'MODEL_TRANSPORT is not set to fixture').toMatch(/MODEL_TRANSPORT:\s*fixture/);
    expect(e2e, 'the run artifacts are not uploaded').toMatch(/upload-artifact/);
    expect(e2e, 'var/e2e/artifacts is not the uploaded path').toMatch(/var\/e2e\/artifacts/);
    expect(e2e, 'the upload does not run when the job fails').toMatch(/if:\s*always\(\)/);
  });

  test('the e2e job runs the lane itself', () => {
    const e2e = workflowJobs(workflow())['e2e'] ?? '';
    expect(e2e, 'the e2e job never runs `pnpm e2e`').toMatch(/pnpm (?:run )?e2e\b/);
  });
});

