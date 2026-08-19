/**
 * The database lane's tree-and-surface contract (M0-02). Everything asserted here
 * is true without a database, so it runs inside `pnpm test` — and therefore
 * inside `pnpm verify` — where no Postgres is guaranteed.
 *
 * The live proofs (scoped read, RLS refusal, cross-tenant write refusal,
 * append-only grants, role split) live in `tests/e2e/db-lane.e2e.ts`, which
 * drives a real migrated database.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = process.env['FOREMAN_REPO_ROOT'] ?? process.cwd();
const read = (relativePath: string): string => readFileSync(join(repoRoot, relativePath), 'utf8');
const scripts = (): Record<string, string> => {
  const parsed: unknown = JSON.parse(read('package.json'));
  const bag = (parsed as { scripts?: Record<string, string> }).scripts;
  return bag ?? {};
};

/** Every file under `directory`, recursively, as repo-relative paths. */
function walk(directory: string, matching: RegExp): string[] {
  const absolute = join(repoRoot, directory);
  if (!existsSync(absolute)) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        visit(path);
        continue;
      }
      if (matching.test(entry.name)) out.push(relative(repoRoot, path));
    }
  };
  visit(absolute);
  return out;
}

describe('AC-01/AC-02/AC-07 the lane is wired into package.json', () => {
  test('db:migrate runs scripts/db-migrate.mjs', () => {
    expect(scripts()['db:migrate']).toBe('node scripts/db-migrate.mjs');
  });

  test('db:drift runs scripts/db-drift.mjs', () => {
    expect(scripts()['db:drift']).toBe('node scripts/db-drift.mjs');
  });

  test('test:db is its own vitest lane', () => {
    expect(scripts()['test:db']).toBe('vitest run --config vitest.db.config.ts');
  });

  test('the declared dependencies are in the manifest', () => {
    const parsed: unknown = JSON.parse(read('package.json'));
    const manifest = parsed as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const dependency of ['drizzle-orm', 'drizzle-kit', 'pg', '@types/pg']) {
      expect(Object.keys(all)).toContain(dependency);
    }
  });
});

describe('AC-01/AC-07 the lane exists in the tree', () => {
  for (const path of [
    'db/schema/index.ts',
    'db/schema/tenancy.ts',
    'src/core/db.ts',
    'scripts/db-migrate.mjs',
    'scripts/db-drift.mjs',
    'scripts/verify.d/50-db-drift.mjs',
    'vitest.db.config.ts',
    'drizzle.config.ts',
  ]) {
    test(`${path} is committed`, () => {
      expect(existsSync(join(repoRoot, path))).toBe(true);
    });
  }

  test('db/migrations/0000_init/ holds the initial SQL migration', () => {
    const dir = join(repoRoot, 'db', 'migrations', '0000_init');
    expect(existsSync(dir) && statSync(dir).isDirectory()).toBe(true);
    const sql = walk('db/migrations/0000_init', /\.sql$/);
    expect(sql.length).toBeGreaterThan(0);
  });

  test('the initial migration forces row level security itself (risk note 1)', () => {
    const sql = walk('db/migrations/0000_init', /\.sql$/)
      .map((path) => read(path))
      .join('\n')
      .toLowerCase();
    expect(sql).toMatch(/force\s+row\s+level\s+security/);
  });

  test('db/schema/index.ts is a barrel over the schema modules', () => {
    expect(read('db/schema/index.ts')).toMatch(/tenancy/);
  });
});

describe('AC-08 src/core/db.ts is the only module that touches driver or schema', () => {
  /**
   * Scoped to `src/**` — the application. The migrate/drift scripts and the seam
   * suite under `db/__tests__/` connect on purpose; the boundary this criterion
   * draws is that no *application* module reaches past the seam.
   */
  const DRIVER_OR_SCHEMA = /from\s+['"](?:pg|drizzle-orm[^'"]*|[^'"]*db\/schema[^'"]*)['"]|require\(\s*['"]pg['"]/;

  test('src/core/db.ts holds the driver and schema imports, and no other module does', () => {
    expect(existsSync(join(repoRoot, 'src/core/db.ts'))).toBe(true);
    // The seam is the importer — not merely a file nobody else imports past.
    expect(DRIVER_OR_SCHEMA.test(read('src/core/db.ts'))).toBe(true);

    const offenders = walk('src', /\.(ts|tsx)$/)
      .filter((path) => path.replace(/\\/g, '/') !== 'src/core/db.ts')
      .filter((path) => DRIVER_OR_SCHEMA.test(read(path)));
    expect(offenders).toEqual([]);
  });
});

describe('AC-08 SEAM-TENANT is the whole public surface', () => {
  const load = async (): Promise<Record<string, unknown>> => {
    const module: unknown = await import('../../src/core/db');
    return module as Record<string, unknown>;
  };

  test('exports exactly forTenant and runAsSystem', async () => {
    const module = await load();
    expect(Object.keys(module).sort()).toEqual(['forTenant', 'runAsSystem']);
  });

  /**
   * The handle shape the whole acceptance is written against: `forTenant(ctx)`
   * and `runAsSystem(reason)` each return a handle with one method, `run(work)`,
   * which opens exactly one transaction on a `vextrus_app` connection, sets its
   * settings transaction-locally, calls `work` once with a session exposing
   * `query(text, params?) => { rows }`, and resolves to whatever `work` returned.
   */
  test('forTenant returns a handle whose only job is run(work)', async () => {
    const module = await load();
    const forTenant = module['forTenant'] as (ctx: { tenantId: string }) => { run: unknown };
    const handle = forTenant({ tenantId: '00000000-0000-4000-8000-000000000000' });
    expect(typeof handle.run).toBe('function');
  });

  test('runAsSystem returns the same handle shape', async () => {
    const module = await load();
    const runAsSystem = module['runAsSystem'] as (reason: string) => { run: unknown };
    expect(typeof runAsSystem('acceptance: surface check').run).toBe('function');
  });

  for (const [label, ctx] of [
    ['an empty tenantId', { tenantId: '' }],
    ['a whitespace tenantId', { tenantId: '   ' }],
    ['no tenantId at all', {}],
  ] as const) {
    test(`forTenant refuses ${label} with TENANT_REQUIRED`, async () => {
      const module = await load();
      const forTenant = module['forTenant'] as (ctx: unknown) => unknown;
      expect(() => forTenant(ctx)).toThrow(/TENANT_REQUIRED/);
    });
  }
});

describe('AC-02 the seam suite discovers its tables', () => {
  test('db/__tests__/ introspects the catalog for tenant_id', () => {
    const sources = walk('db/__tests__', /\.(ts|mts)$/);
    expect(sources.length).toBeGreaterThan(0);
    const joined = sources.map((path) => read(path)).join('\n');
    expect(joined).toMatch(/information_schema\.columns|pg_attribute/);
    expect(joined).toMatch(/tenant_id/);
  });
});
