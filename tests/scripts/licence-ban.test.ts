/**
 * The Node-runtime half of the licence test (AC-04; L-CAD-04).
 *
 * `@vivliostyle/cli` is AGPL and banned in shipped code, and the ban has to be a
 * thing that fires rather than a thing that is written down: the proof is a
 * tampered manifest fed to the real scanner through `LICENCE_PACKAGE_JSON`, and
 * the real manifest passing the same scanner.
 *
 * The stage is driven as a subprocess rather than imported: a stage file does
 * its work at module scope, so importing it would run it (risk note 5). It is
 * TypeScript under `tests/scripts/` for the same reason the other drop-in-runner
 * fixture tests are — `pnpm test` must execute only extensions the Q-08
 * guardrail can see.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = process.env['FOREMAN_REPO_ROOT'] ?? process.cwd();
const stage = join(repoRoot, 'scripts', 'verify.d', '70-cad.mjs');

interface StageRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

function runStage(env: Record<string, string> = {}): StageRun {
  const result = spawnSync(process.execPath, [stage], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 900_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

/** A manifest with the given dependency section, written where the scanner is pointed. */
function tamperedPackageJson(section: string, name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'vextrus-licence-'));
  const path = join(directory, 'package.json');
  const manifest = {
    name: 'tampered',
    version: '0.0.0',
    private: true,
    dependencies: {},
    devDependencies: {},
    [section]: { [name]: '9.9.9' },
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

/** A manifest that names nothing banned. */
function cleanPackageJson(): string {
  const directory = mkdtempSync(join(tmpdir(), 'vextrus-licence-ok-'));
  const path = join(directory, 'package.json');
  writeFileSync(
    path,
    `${JSON.stringify({ name: 'clean', version: '0.0.0', private: true, dependencies: { next: '16.3.1' } }, null, 2)}\n`,
    'utf8',
  );
  return path;
}

const BANNED = '@vivliostyle/cli';

describe('AC-04 — the banned AGPL renderer fails the cad stage', () => {
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    test(`${BANNED} in ${section} refuses with BANNED_DEPENDENCY and a non-zero exit`, () => {
      // AC-04: `BANNED_DEPENDENCY <name> in <file>`, exit 1.
      const path = tamperedPackageJson(section, BANNED);
      const result = runStage({ LICENCE_PACKAGE_JSON: path });

      expect(result.status, result.output).not.toBe(0);
      expect(result.stdout, result.output).toMatch(
        new RegExp(`^BANNED_DEPENDENCY ${BANNED.replace('/', '\\/')} in `, 'm'),
      );
      expect(result.stdout, 'the line names the file it scanned').toContain(path);
    }, 900_000);
  }

  test('the licence scan is the first step: no ruff or pytest output precedes the refusal', () => {
    // AC-01: fail-fast, licence scan first — so a banned dependency never pays
    // for a python run.
    const result = runStage({ LICENCE_PACKAGE_JSON: tamperedPackageJson('devDependencies', BANNED) });

    expect(result.status, result.output).not.toBe(0);
    expect(result.stdout, result.output).toMatch(/^BANNED_DEPENDENCY /m);
    expect(result.output, 'pytest must not have run').not.toMatch(/\d+ (passed|failed|error)/);
  }, 900_000);

  test('a manifest that names nothing banned leaves the stage green', () => {
    const result = runStage({ LICENCE_PACKAGE_JSON: cleanPackageJson() });

    expect(result.stdout, result.output).not.toMatch(/^BANNED_DEPENDENCY/m);
    expect(result.status, result.output).toBe(0);
  }, 900_000);
});

describe('AC-04 — the real tree passes the same scanner', () => {
  test('node scripts/verify.d/70-cad.mjs exits 0 standalone against the committed files', () => {
    // AC-01/AC-04: the stage is runnable on its own and green on a clean tree.
    const result = runStage();

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).not.toMatch(/^BANNED_DEPENDENCY/m);
    expect(result.stdout).not.toMatch(/^BANNED_TOOL_REFERENCE/m);
  }, 900_000);
});
