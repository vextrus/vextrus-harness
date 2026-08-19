/**
 * V-DB, attacked. Each test here is a defect that was reproduced against a live
 * scratch Postgres, written down so it cannot come back.
 *
 * These are the same lane and the same contract as db-lane.e2e.ts — SEAM-TENANT,
 * R-SPINE-004, B-05 — approached from the other side: not "does the promise hold
 * when it is used as intended", but "what does it take to make the promise
 * false". A guardrail is mechanical (B-05) only if it fires for the caller who
 * was not trying to be careful.
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts tests/e2e/db-lane-breaker.e2e.ts
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { repoRoot, runCli } from '../acceptance/support/cli';
import { asRole, discoverTenantTables, seedFixture, type Fixture } from './support/db-lane';

const pnpm = (args: readonly string[], timeoutMs = 240_000) => runCli('pnpm', args, {}, timeoutMs);

/** The seam as a child process sees it: its own module URL, its own pool. */
const seamUrl = (): string => pathToFileURL(join(repoRoot(), 'src', 'core', 'db.ts')).href;

let scratch: string;
let fixture: Fixture;

/**
 * A probe that has to run in a process of its own: the leak these tests hunt is
 * a property of one pool over successive handles, and `VDB_POOL_SIZE=1` is what
 * makes "the next request lands on the same connection" a certainty rather than
 * a one-in-five flake.
 */
function runProbe(
  name: string,
  source: string,
  args: readonly string[] = [],
): { status: number; stdout: string; stderr: string } {
  const file = join(scratch, name);
  writeFileSync(file, source);
  const result = runCli(
    process.execPath,
    [file, seamUrl(), ...args],
    { VDB_POOL_SIZE: '1' },
    60_000,
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'vextrus-breaker-'));
  const migrated = pnpm(['db:migrate']);
  expect(migrated.status, `pnpm db:migrate failed:\n${migrated.output}`).toBe(0);
  fixture = await seedFixture();
}, 300_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('SEAM-TENANT the seam survives a caller that leaves state behind', () => {
  /**
   * The seam's own settings are transaction-local, but `forTenant` never says
   * anything about `app.system` — so an `app.system` that some earlier caller
   * left on the pooled connection is still on when the next tenant's
   * transaction begins, and the RLS predicate's system arm turns every policy in
   * the database off for a request that never asked to escalate.
   *
   * Reproduced: `forTenant(A)` issues a session-level `set_config` (the third
   * argument is the whole difference between local and not), and the very next
   * `forTenant(B)` reads tenant A's rows and writes a row owned by A.
   *
   * R-SPINE-004 — scoped read and cross-tenant write refusal are properties of
   * `forTenant`, not of the care its callers take.
   */
  test('scoped-read — forTenant does not inherit an app.system left on the pooled connection', () => {
    const probe = runProbe(
      'residue.mjs',
      [
        'const [, , seam, a, b] = process.argv;',
        'const { forTenant } = await import(seam);',
        '// An earlier caller escalates without meaning to: session-level, not local.',
        'await forTenant({ tenantId: a }).run(async (session) => {',
        "  await session.query(\"select set_config('app.system', 'on', false)\");",
        '});',
        '// A different tenant, the same pooled connection, no escalation asked for.',
        'const read = await forTenant({ tenantId: b }).run(async (session) => {',
        "  const result = await session.query('select distinct tenant_id::text as t from seam_probe_rows');",
        '  return result.rows.map((row) => row.t);',
        '});',
        "let wrote = 'refused';",
        'try {',
        '  await forTenant({ tenantId: b }).run(async (session) => {',
        '    await session.query(',
        "      \"insert into seam_probe_rows (id, tenant_id, label) values (gen_random_uuid(), $1, 'leaked through the pool')\",",
        '      [a],',
        '    );',
        '  });',
        "  wrote = 'allowed';",
        '} catch {}',
        "process.stdout.write(JSON.stringify({ read, wrote }) + '\\n');",
        '',
      ].join('\n'),
      [fixture.a, fixture.b],
    );

    expect(probe.status, `probe failed:\n${probe.stdout}\n${probe.stderr}`).toBe(0);
    const answer = JSON.parse(probe.stdout.trim()) as { read: string[]; wrote: string };

    expect(
      answer.read.filter((tenantId) => tenantId !== fixture.b),
      `forTenant(B) read rows of another tenant: ${JSON.stringify(answer.read)}`,
    ).toEqual([]);
    expect(answer.wrote, 'forTenant(B) wrote a row owned by tenant A').toBe('refused');
  });

  /**
   * The escalation line is the only record that `runAsSystem` happened. A reason
   * carrying a newline writes a second line that reads exactly like a second
   * escalation — one call, two entries, and the extra one says whatever its
   * caller wanted it to say.
   */
  test('runAsSystem writes exactly one audit line per escalation', () => {
    const probe = runProbe(
      'audit.mjs',
      [
        'const [, , seam, reason] = process.argv;',
        'const { runAsSystem } = await import(seam);',
        'await runAsSystem(reason).run(async () => 0);',
        '',
      ].join('\n'),
      ['audit probe\nSEAM-TENANT runAsSystem reason=forged'],
    );

    expect(probe.status, `probe failed:\n${probe.stderr}`).toBe(0);
    const lines = probe.stderr
      .split('\n')
      .filter((line) => line.startsWith('SEAM-TENANT runAsSystem'));
    expect(lines, `one escalation logged ${String(lines.length)} lines: ${JSON.stringify(lines)}`)
      .toHaveLength(1);
  });
});

describe('V-DB append-only is a property of the table, not of the verb used', () => {
  /**
   * The migration's trigger exists so append-only holds for roles the grants do
   * not stop — "a property of the table rather than of who is asking", in its
   * own words. It fires `BEFORE UPDATE OR DELETE`, and TRUNCATE is neither: the
   * owner empties the ledger in one statement, with no error.
   *
   * The attempt is wrapped in a transaction that rolls back, so this test proves
   * the refusal without being able to destroy the fixture it shares.
   */
  test('append-only-grants — TRUNCATE on an append-only table is refused for every role', async () => {
    const owner = await asRole(
      'vextrus_migrate',
      'begin; truncate seam_probe_ledger; rollback;',
    );
    expect(
      owner.error,
      'vextrus_migrate truncated the append-only ledger — DELETE is refused, TRUNCATE is not',
    ).toBeDefined();

    const app = await asRole('vextrus_app', 'begin; truncate seam_probe_ledger; rollback;');
    expect(app.error, 'vextrus_app truncated the append-only ledger').toBeDefined();
  });
});

describe('AC-07 db:drift sees the whole of db/migrations/', () => {
  /**
   * The drift check compares db/schema/ against the committed snapshot in
   * db/migrations/meta/ — and nothing compares either against the SQL that is
   * actually applied. Every `ENABLE ROW LEVEL SECURITY` and every `CREATE POLICY`
   * can be deleted from db/migrations/0000_init/0000_schema.sql and the tree
   * still reports clean, so `pnpm verify` stays green over a migration lane that
   * would build a database with no row level security in it at all.
   *
   * Reproduced: with those six statements removed, `pnpm db:migrate` against a
   * fresh database succeeds and `pnpm test:db` goes red — which is the live lane
   * catching, after the fact, what the tree-level guardrail said was fine.
   */
  test('a migration that no longer declares the schema RLS is drift', () => {
    const initSql = join(repoRoot(), 'db', 'migrations', '0000_init', '0000_schema.sql');
    const original = readFileSync(initSql, 'utf8');
    const gutted = original
      .split('\n')
      .filter((line) => !/ENABLE ROW LEVEL SECURITY|CREATE POLICY/i.test(line))
      .join('\n');
    expect(gutted, 'the fixture removed nothing — has the migration been rewritten?').not.toBe(
      original,
    );

    try {
      writeFileSync(initSql, gutted);
      const drift = pnpm(['db:drift']);
      expect(
        drift.status,
        `db:drift called a migration with no RLS statements clean:\n${drift.output}`,
      ).not.toBe(0);
      expect(drift.output).toMatch(/DRIFT/);
    } finally {
      writeFileSync(initSql, original);
    }
  });
});

describe('R-SPINE-004 discovery covers every relation that carries tenant_id', () => {
  /**
   * The seam suite discovers by `relkind = 'r'`, and so does `seam_secure`. A
   * partitioned table is `relkind = 'p'`: it carries `tenant_id`, it is the
   * relation queries name, its policies are the ones that apply to rows routed
   * through it — and both the migration's security pass and the lane that proves
   * the pass happened walk straight past it.
   *
   * Reproduced: with the relation below present, unsecured and granted to
   * nobody's satisfaction, `pnpm test:db` was green on 22 of 22.
   */
  test('rls-coverage — a tenant_id partitioned table with no forced RLS is discovered and refused', async () => {
    const created = await asRole(
      'vextrus_migrate',
      `create table breaker_partitioned (
         id uuid not null,
         tenant_id uuid not null,
         label text not null,
         primary key (tenant_id, id)
       ) partition by list (tenant_id)`,
    );
    expect(created.error, `heldout could not be created: ${String(created.error)}`).toBeUndefined();

    try {
      expect(
        await discoverTenantTables(),
        'the catalog does not report the heldout as tenant-scoped',
      ).toContain('public.breaker_partitioned');

      const lane = pnpm(['test:db']);
      expect(
        lane.status,
        `pnpm test:db was green with an unsecured tenant_id relation in the database:\n${lane.output}`,
      ).not.toBe(0);
    } finally {
      await asRole('vextrus_migrate', 'drop table if exists breaker_partitioned');
    }
  });
});
