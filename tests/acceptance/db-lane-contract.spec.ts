/**
 * Contract acceptance for the database lane (V-DB, SEAM-TENANT, layout-db).
 *
 * Everything here is a statement about the committed tree, so it belongs in
 * `pnpm test` and therefore inside `pnpm verify`: no database is touched and
 * nothing is spawned. The live proofs — RLS, the role split, the seam's
 * transactionality — are the journey in `tests/e2e/db-lane.e2e.ts`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = process.cwd();

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');
const exists = (relative: string): boolean => existsSync(join(repoRoot, relative));

const packageJson = (): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(read('package.json'));
  return parsed as Record<string, unknown>;
};

const record = (value: unknown): Record<string, string> => (value ?? {}) as Record<string, string>;

/** Every file under a directory, recursively — [] when it does not exist. */
function filesUnder(relative: string): string[] {
  const root = join(repoRoot, relative);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

describe('AC-01/AC-07 — the database lane entry points', () => {
  test('package.json declares db:migrate, db:drift and test:db as the spec names them', () => {
    const scripts = record(packageJson()['scripts']);
    expect(Object.keys(scripts)).toContain('db:migrate');
    expect(Object.keys(scripts)).toContain('db:drift');
    expect(Object.keys(scripts)).toContain('test:db');
    expect(scripts['db:migrate']).toMatch(/scripts\/db-migrate\.mjs/);
    expect(scripts['db:drift']).toMatch(/scripts\/db-drift\.mjs/);
    expect(scripts['test:db']).toMatch(/vitest run .*--config vitest\.db\.config\.ts/);
  });

  test('the lane declares its dependencies — drizzle-orm, drizzle-kit, pg, @types/pg', () => {
    const pkg = packageJson();
    const all = { ...record(pkg['dependencies']), ...record(pkg['devDependencies']) };
    for (const dependency of ['drizzle-orm', 'drizzle-kit', 'pg', '@types/pg']) {
      expect(Object.keys(all)).toContain(dependency);
    }
    // AC-07 of the scaffold still holds: exact pins, no ranges.
    for (const name of ['drizzle-orm', 'drizzle-kit', 'pg', '@types/pg']) {
      expect(`${name}@${all[name] ?? ''}`).toMatch(/@\d+\.\d+\.\d+(-[\w.]+)?$/);
    }
    expect(Number.parseInt(all['drizzle-kit'] ?? '', 10)).toBe(0);
    expect(all['drizzle-kit'] ?? '').toMatch(/^0\.4\d+\./);
  });

  test('the files the lane owns are in the tree', () => {
    for (const path of [
      'db/schema/index.ts',
      'db/schema/tenancy.ts',
      'src/core/db.ts',
      'scripts/db-migrate.mjs',
      'scripts/db-drift.mjs',
      'scripts/verify.d/50-db-drift.mjs',
      'drizzle.config.ts',
      'vitest.db.config.ts',
    ]) {
      expect(exists(path), `${path} must exist`).toBe(true);
    }
  });

  test('the initial migration is a directory under db/migrations/ holding SQL', () => {
    const initDir = join(repoRoot, 'db/migrations/0000_init');
    expect(existsSync(initDir), 'db/migrations/0000_init/ must exist').toBe(true);
    expect(statSync(initDir).isDirectory()).toBe(true);
    const sql = filesUnder('db/migrations/0000_init').filter((f) => f.endsWith('.sql'));
    expect(sql.length, 'the initial migration must ship SQL').toBeGreaterThan(0);
  });

  test('the db-drift verify stage follows the drop-in stage conventions', () => {
    const stage = read('scripts/verify.d/50-db-drift.mjs');
    // Stages are discovered, never named by the runner (the scaffold's contract).
    expect(read('scripts/verify.mjs')).not.toMatch(/50-db-drift/);
    // It reuses the shared plumbing rather than reinventing spawn/report.
    expect(stage).toMatch(/\.\.\/lib\/(stage|report)\.mjs/);
  });
});

describe('AC-06 — append-only is declared in the schema, not in prose', () => {
  test('APPEND_ONLY_TABLES is exported from the schema and names seam_probe_ledger', async () => {
    const specifier = '../../db/schema/index.ts';
    const loaded: unknown = await import(/* @vite-ignore */ specifier);
    const mod = (loaded ?? {}) as Record<string, unknown>;
    const appendOnly = mod['APPEND_ONLY_TABLES'];
    expect(Array.isArray(appendOnly), 'APPEND_ONLY_TABLES must be exported from the barrel').toBe(
      true,
    );
    expect(appendOnly as unknown[]).toContain('seam_probe_ledger');
  });

  test('the schema barrel composes modules rather than declaring tables itself', () => {
    const barrel = read('db/schema/index.ts');
    // layout-db: one schema per module, composed once — the barrel is import/export lines.
    expect(barrel).toMatch(/tenancy/);
    expect(barrel, 'tables belong in their module, not in the barrel').not.toMatch(/pgTable\s*\(/);
  });

  test('tenancy.ts declares the probe tables and the forced-RLS helper', () => {
    const tenancy = read('db/schema/tenancy.ts');
    for (const symbol of ['tenants', 'seam_probe_rows', 'seam_probe_ledger', 'tenantRls']) {
      expect(tenancy).toMatch(new RegExp(symbol.replace(/_/g, '_?')));
    }
  });
});

describe('AC-08 — src/core/db.ts is the only database handle', () => {
  /** Application modules only: the migration lane is a script, not a module. */
  const applicationSources = (): string[] =>
    filesUnder('src').filter(
      (file) =>
        /\.(ts|tsx)$/.test(file) &&
        !/\.(test|spec|bench)\.tsx?$/.test(file) &&
        !file.includes(`${join('src', '__tests__')}`) &&
        !/[\\/]__tests__[\\/]/.test(file),
    );

  const DRIVER_OR_SCHEMA = /from\s+['"](?:pg|drizzle-orm[^'"]*|[^'"]*db\/schema[^'"]*)['"]/;

  /**
   * Both halves in one test on purpose. "Nobody imports the driver" is true of
   * an empty tree, so the sole-importer claim only means something once the seam
   * itself is the importer — asserting the two together keeps this from passing
   * for the wrong reason.
   */
  test('src/core/db.ts owns the driver import, and no other application module has one', () => {
    expect(exists('src/core/db.ts'), 'the seam must exist to be the sole importer').toBe(true);
    expect(read('src/core/db.ts'), 'the seam must own the driver import').toMatch(DRIVER_OR_SCHEMA);

    const seam = join(repoRoot, 'src/core/db.ts');
    const offenders = applicationSources()
      .filter((file) => file !== seam)
      .filter((file) => DRIVER_OR_SCHEMA.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(repoRoot.length + 1));
    expect(offenders, 'SEAM-TENANT: the seam is the only importer').toEqual([]);
  });

  test('the seam re-exports nothing — no driver, no schema, no star', () => {
    const seam = read('src/core/db.ts');
    expect(seam, 'no re-export of driver or schema').not.toMatch(/export\s+\*/);
    expect(seam).not.toMatch(/export\s*\{[^}]*\}\s*from/);
  });

  test('the seam sets its tenant and system settings transaction-locally', () => {
    const seam = read('src/core/db.ts');
    // The classic pooled-connection leak: a SET without the transaction-local
    // flag survives onto the next checkout of the same connection.
    expect(seam).toMatch(/set_config\s*\(/);
    expect(seam, "set_config's third argument must be true — transaction-local").toMatch(
      /set_config\s*\([^)]*true[^)]*\)/,
    );
    expect(seam).toMatch(/app\.tenant_id/);
    expect(seam).toMatch(/app\.system/);
    // It connects as the runtime role, never as the owner.
    expect(seam).toMatch(/vextrus_app/);
    expect(seam).not.toMatch(/vextrus_migrate/);
  });

  test('the refusal names are the ones callers can match on', () => {
    const seam = read('src/core/db.ts');
    expect(seam).toMatch(/TENANT_REQUIRED/);
    expect(seam).toMatch(/SYSTEM_REASON_REQUIRED/);
  });

  /**
   * The spec pins the two function names and pins that a handle's work runs in
   * one transaction; it does not pin how the work is handed to the handle. The
   * journey accepts any of these shapes, and this test states the list where the
   * implementer reads it rather than leaving it to be guessed.
   */
  test('a scoped handle takes its unit of work in one of the accepted shapes', () => {
    const seam = read('src/core/db.ts');
    const accepted = /\b(?:run|transaction|tx|withTransaction|do)\b|=>\s*(?:async\s*)?\(?work/;
    expect(
      accepted.test(seam),
      'a handle must be callable with a unit of work, or expose one of: run, transaction, tx, withTransaction, do',
    ).toBe(true);
  });
});

describe('AC-02 — the live suite discovers its tables', () => {
  const suiteSources = (): string[] =>
    filesUnder('db/__tests__').filter((file) => /\.(ts|mts)$/.test(file));

  test('the V-DB suite exists under db/__tests__/ and vitest.db.config.ts points at it', () => {
    expect(suiteSources().length, 'db/__tests__/ must hold the V-DB suite').toBeGreaterThan(0);
    expect(read('vitest.db.config.ts')).toMatch(/db\/__tests__/);
  });

  test('the suite finds tenant-scoped tables by introspection', () => {
    const source = suiteSources()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(source, 'discovery keys on the tenant_id column').toMatch(/tenant_id/);
    expect(source, 'discovery reads the catalog').toMatch(
      /pg_attribute|pg_class|information_schema/,
    );
    // Excluding the ledger schema is part of the discovery contract.
    expect(source).toMatch(/drizzle/);
  });

  test('the suite titles carry the seam fact names', () => {
    const source = suiteSources()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    for (const fact of [
      'scoped-read',
      'rls-refusal',
      'cross-tenant-write-refusal',
      'append-only-grants',
      'rls-coverage',
      'composite-fk-backstop',
      'role-split',
      'migration-ledger',
    ]) {
      expect(source, `the suite must name the fact ${fact}`).toMatch(fact);
    }
  });
});
