/**
 * The fixture manifest and its drift check (AC-05 wiring, AC-06, AC-07).
 *
 * L-CAD-09: fixtures are synthetic drawings authored by committed scripts. The
 * manifest is what makes that claim checkable — it records what each fixture was
 * generated from, so a generator that changed without its fixture being
 * regenerated is a fault the tree can be asked about rather than a surprise at
 * the next conversion.
 *
 * `--check` runs no generator, so these are cheap enough for `pnpm test`; the
 * write mode (which reruns ezdxf and reportlab and rewrites the tree) is proved
 * in `tests/e2e/cad-lane.e2e.ts`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = process.env['FOREMAN_REPO_ROOT'] ?? process.cwd();
const script = join(repoRoot, 'scripts', 'gen-fixtures.mjs');

interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly generator: string;
  readonly generatorSha256: string;
}

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

const manifestRaw = (): string => read('fixtures/MANIFEST.json');

const manifest = (): { fixtures: ManifestEntry[] } => {
  const parsed: unknown = JSON.parse(manifestRaw());
  return parsed as { fixtures: ManifestEntry[] };
};

const sha256 = (absolute: string): string =>
  createHash('sha256').update(readFileSync(absolute)).digest('hex');

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly output: string;
}

function runCheck(root?: string): Run {
  const env = root === undefined ? {} : { GEN_FIXTURES_ROOT: root };
  const result = spawnSync(process.execPath, [script, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 300_000,
  });
  const stdout = result.stdout ?? '';
  return { status: result.status ?? 1, stdout, output: `${stdout}\n${result.stderr ?? ''}` };
}

/** A private copy of the committed `fixtures/` tree, to be tampered with freely. */
function fixturesCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'vextrus-fixtures-'));
  cpSync(join(repoRoot, 'fixtures'), join(root, 'fixtures'), { recursive: true });
  return root;
}

const driftLines = (stdout: string): string[] =>
  stdout.split('\n').filter((line) => line.startsWith('MANIFEST_DRIFT'));

describe('AC-06 — the manifest is a sorted record of fixture and generator hashes', () => {
  test('it is { fixtures: [...] } written LF with a trailing newline', () => {
    const raw = manifestRaw();
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).not.toContain('\r');
    expect(Array.isArray(manifest().fixtures)).toBe(true);
  });

  test('every entry has exactly the four keys, POSIX paths and lowercase digests', () => {
    for (const entry of manifest().fixtures) {
      expect(Object.keys(entry).sort()).toEqual(['generator', 'generatorSha256', 'path', 'sha256']);
      expect(entry.path).not.toContain('\\');
      expect(entry.path.startsWith('fixtures/'), entry.path).toBe(true);
      expect(entry.generator.startsWith('fixtures/gen/'), entry.generator).toBe(true);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.generatorSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('the entries are sorted by path', () => {
    const paths = manifest().fixtures.map((entry) => entry.path);
    expect(paths).toEqual([...paths].sort());
  });

  test('the two committed smoke fixtures are recorded against their generators', () => {
    // AC-06 / L-CAD-09: ezdxf for the DXF, reportlab (D-04) for the vector PDF.
    const byPath = new Map(manifest().fixtures.map((entry) => [entry.path, entry]));

    expect(byPath.get('fixtures/gen/out/smoke_lines.dxf')?.generator).toBe(
      'fixtures/gen/gen_smoke_lines.py',
    );
    expect(byPath.get('fixtures/gen/out/smoke_page.pdf')?.generator).toBe(
      'fixtures/gen/gen_smoke_page.py',
    );
  });

  test('every recorded digest matches the committed bytes', () => {
    for (const entry of manifest().fixtures) {
      expect(sha256(join(repoRoot, entry.path)), `sha256 of ${entry.path}`).toBe(entry.sha256);
      expect(sha256(join(repoRoot, entry.generator)), `sha256 of ${entry.generator}`).toBe(
        entry.generatorSha256,
      );
    }
  });
});

describe('AC-07 — --check reads the tree and refuses on drift', () => {
  test('a clean tree exits 0 and says so with a count', () => {
    const result = runCheck();

    expect(result.status, result.output).toBe(0);
    expect(result.stdout, result.output).toMatch(/^manifest ok \(\d+ fixtures\)$/m);
  }, 300_000);

  test('GEN_FIXTURES_ROOT moves the root it reads: an untouched copy still passes', () => {
    const result = runCheck(fixturesCopy());

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/^manifest ok/m);
  }, 300_000);

  test('a fixture edited byte-for-byte drifts, naming that fixture', () => {
    const root = fixturesCopy();
    const fixture = join(root, 'fixtures', 'gen', 'out', 'smoke_lines.dxf');
    writeFileSync(fixture, Buffer.concat([readFileSync(fixture), Buffer.from('\n')]));

    const result = runCheck(root);

    expect(result.status, result.output).toBe(1);
    expect(driftLines(result.stdout).length, result.output).toBe(1);
    expect(result.stdout).toMatch(/^MANIFEST_DRIFT fixtures\/gen\/out\/smoke_lines\.dxf — \S/m);
  }, 300_000);

  test('a fixture that is gone drifts, naming the missing path', () => {
    const root = fixturesCopy();
    rmSync(join(root, 'fixtures', 'gen', 'out', 'smoke_page.pdf'));

    const result = runCheck(root);

    expect(result.status, result.output).toBe(1);
    expect(result.stdout).toMatch(/^MANIFEST_DRIFT fixtures\/gen\/out\/smoke_page\.pdf — \S/m);
  }, 300_000);
});
