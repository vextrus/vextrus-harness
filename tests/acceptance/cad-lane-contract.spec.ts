/**
 * The cad lane's tree-and-surface contract (M0-04).
 *
 * Everything here is either a file read or a short subprocess, so it runs inside
 * `pnpm test` — and therefore inside `pnpm verify` — the same way the db lane's
 * contract does. The whole-run proofs that must not re-enter the verify run
 * (`pnpm verify` itself, `pnpm gen:fixtures` rewriting the tree) live in
 * `tests/e2e/cad-lane.e2e.ts`.
 *
 * L-CAD-04: PyMuPDF/fitz/mutool and `@vivliostyle/cli` are banned in shipped
 * code; DXF via ezdxf, PDF via pypdfium2. D-04: reportlab is acceptable in
 * fixtures generation only, never in the app — so it is pinned in the `fixtures`
 * dependency group and nowhere else.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = process.env['FOREMAN_REPO_ROOT'] ?? process.cwd();

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

const exists = (relative: string): boolean => existsSync(join(repoRoot, relative));

const packageJson = (): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(read('package.json'));
  return parsed as Record<string, unknown>;
};

const record = (value: unknown): Record<string, string> => (value ?? {}) as Record<string, string>;

/**
 * The body of a TOML table: everything from its header up to the next header at
 * the start of a line. Enough to read a pyproject without adding a dependency to
 * a repo whose npm surface this increment deliberately does not grow.
 */
function table(toml: string, name: string): string {
  const header = new RegExp(`^\\[${name.replace(/[.[\]]/g, '\\$&')}\\]\\s*$`, 'm');
  const start = header.exec(toml);
  if (start === null) return '';
  const rest = toml.slice(start.index + start[0].length);
  const next = /^\[/m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

/** `key = ["a==1", "b==2"]` -> `['a==1', 'b==2']`, single- or multi-line. */
function arrayValue(body: string, key: string): string[] {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(body);
  if (match === null) return [];
  return (match[1] ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^["']|["']$/g, '').trim())
    .filter((entry) => entry !== '' && !entry.startsWith('#'));
}

/** `key = "value"` -> `value`. */
function stringValue(body: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm').exec(body);
  return match?.[1];
}

const pyproject = (): string => read('cad/pyproject.toml');

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): CliResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: 900_000,
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

describe('AC-01 — the cad stage and its neighbours are drop-in files in order', () => {
  test('scripts/verify.d/70-cad.mjs is committed', () => {
    // AC-01: the stage file is `scripts/verify.d/70-cad.mjs` (stage name `cad`).
    expect(exists('scripts/verify.d/70-cad.mjs')).toBe(true);
  });

  test('it sorts after the db-drift stage and before the build stage', () => {
    // AC-01: the runner discovers stages in filename order, so `== stage cad ==`
    // lands between `== stage db-drift ==` and `== stage build ==` by the number.
    const stages = readdirSync(join(repoRoot, 'scripts', 'verify.d'))
      .filter((entry) => entry.endsWith('.mjs'))
      .sort();
    const position = (fragment: string): number =>
      stages.findIndex((entry) => entry.includes(fragment));

    expect(position('cad'), 'the cad stage must be discovered').toBeGreaterThanOrEqual(0);
    expect(position('cad')).toBeGreaterThan(position('db-drift'));
    expect(position('cad')).toBeLessThan(position('build'));
  });

  test('the stage runs the five steps in the fail-fast order the contract names', () => {
    // AC-01: licence scan -> gen-fixtures --check -> ODA scan -> ruff -> pytest.
    const stage = read('scripts/verify.d/70-cad.mjs');
    const positions = [
      stage.search(/BANNED_DEPENDENCY/),
      stage.search(/gen-fixtures\.mjs/),
      stage.search(/BANNED_TOOL_REFERENCE/),
      stage.search(/ruff/),
      stage.search(/pytest/),
    ];
    for (const [index, position] of positions.entries()) {
      expect(position, `step ${String(index)} must appear in the stage`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i] ?? -1, `step ${String(i)} comes after step ${String(i - 1)}`).toBeGreaterThan(
        positions[i - 1] ?? -1,
      );
    }
  });

  test('scripts/gen-fixtures.mjs and scripts/checkup.d/20-uv.mjs are committed', () => {
    // AC-05 / AC-08: the two other entry points this increment adds.
    expect(exists('scripts/gen-fixtures.mjs')).toBe(true);
    expect(exists('scripts/checkup.d/20-uv.mjs')).toBe(true);
  });

  test('package.json wires gen:fixtures to the script and adds no npm dependency', () => {
    // AC-05: `gen:fixtures` = `node scripts/gen-fixtures.mjs`.
    const pkg = packageJson();
    expect(record(pkg['scripts'])['gen:fixtures']).toBe('node scripts/gen-fixtures.mjs');
  });
});

describe('AC-02 — cad/ is a uv-managed Python 3.13 project with permissive pins', () => {
  test('the project is named vextrus_cad and requires the 3.13 line', () => {
    const project = table(pyproject(), 'project');
    expect(stringValue(project, 'name')).toBe('vextrus_cad');
    expect(stringValue(project, 'requires-python') ?? '').toMatch(/3\.13/);
  });

  test('[project.scripts] declares the vextrus-cad console entry', () => {
    const scripts = table(pyproject(), 'project.scripts');
    const entry = stringValue(scripts, '"?vextrus-cad"?');
    expect(entry, 'a `vextrus-cad` entry point').toBeDefined();
    expect(entry ?? '').toMatch(/vextrus_cad/);
  });

  test('ezdxf, pypdfium2, numpy and opencv-python-headless are pinned exactly', () => {
    // L-CAD-04: DXF via ezdxf (MIT), PDF via pypdfium2 (permissive).
    const dependencies = arrayValue(table(pyproject(), 'project'), 'dependencies');
    for (const name of ['ezdxf', 'pypdfium2', 'numpy', 'opencv-python-headless']) {
      const entry = dependencies.find((d) => d.toLowerCase().startsWith(name));
      expect(entry, `${name} must be declared`).toBeDefined();
      expect(entry ?? '', `${name} must be pinned with ==`).toMatch(
        new RegExp(`^${name}\\s*==\\s*\\d`, 'i'),
      );
    }
  });

  test('reportlab is pinned in the fixtures dependency group and nowhere else', () => {
    // D-04: reportlab (BSD) is acceptable in fixtures generation only.
    const toml = pyproject();
    const fixtures = arrayValue(table(toml, 'dependency-groups'), 'fixtures');
    const inGroup = fixtures.find((d) => d.toLowerCase().startsWith('reportlab'));
    expect(inGroup, 'reportlab belongs to the fixtures group').toBeDefined();
    expect(inGroup ?? '').toMatch(/^reportlab\s*==\s*\d/i);

    const projectDependencies = arrayValue(table(toml, 'project'), 'dependencies');
    expect(projectDependencies.some((d) => /reportlab/i.test(d))).toBe(false);
  });

  test('no AGPL PDF library is named anywhere in cad/pyproject.toml', () => {
    // L-CAD-04: AGPL PDF libraries are banned in shipped code.
    const toml = pyproject();
    for (const banned of ['pymupdf', 'fitz', 'mutool']) {
      expect(toml.toLowerCase(), `${banned} must not appear`).not.toContain(banned);
    }
  });

  test('regression guard: @vivliostyle/cli appears nowhere in package.json', () => {
    // L-CAD-04: banned on the Node runtime too. Green today — this is the one
    // assertion here that is a guard rather than a red: the manifest is clean
    // now, and the point is that it stays clean once a renderer is chosen.
    expect(read('package.json')).not.toContain('@vivliostyle/cli');
  });

  test('uv.lock, .python-version and .uv-version are committed', () => {
    expect(exists('cad/uv.lock')).toBe(true);
    expect(read('cad/.python-version').trim()).toBe('3.13');
    expect(read('cad/.uv-version').trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('the python package and its cli module are in the tree', () => {
    expect(exists('cad/src/vextrus_cad')).toBe(true);
    const stem = join(repoRoot, 'cad', 'src', 'vextrus_cad', 'cli');
    expect(existsSync(`${stem}.py`) || existsSync(join(stem, '__init__.py'))).toBe(true);
  });
});

describe('AC-03 — the M0 CLI parses arguments and refuses', () => {
  const cad = join(repoRoot, 'cad');

  for (const subcommand of ['ingest', 'validate']) {
    test(`${subcommand} refuses with NOT_IMPLEMENTED_UNTIL_M1 and exits 3`, () => {
      // AC-03: exactly one stdout line, exit 3 (the refusal code).
      const result = run('uv', ['run', 'vextrus-cad', subcommand, 'some.dxf'], { cwd: cad });

      expect(result.status, result.output).toBe(3);
      expect(result.stdout.split('\n').filter((line) => line.trim() !== '')).toEqual([
        `NOT_IMPLEMENTED_UNTIL_M1 ${subcommand}`,
      ]);
    }, 900_000);
  }

  test('a missing path is a usage error: exit 2, usage on stderr, no refusal line', () => {
    // AC-03: exit 2 for usage, and the refusal must not be printed.
    const result = run('uv', ['run', 'vextrus-cad', 'ingest'], { cwd: cad });

    expect(result.status, result.output).toBe(2);
    expect(result.stderr.trim(), 'usage text on stderr').not.toBe('');
    expect(result.output).not.toContain('NOT_IMPLEMENTED_UNTIL_M1');
  }, 900_000);

  test('an unknown subcommand is a usage error too', () => {
    const result = run('uv', ['run', 'vextrus-cad', 'bogus'], { cwd: cad });

    expect(result.status, result.output).toBe(2);
    expect(result.stderr.trim()).not.toBe('');
    expect(result.output).not.toContain('NOT_IMPLEMENTED_UNTIL_M1');
  }, 900_000);
});

describe('AC-04 — the licence test exists on both runtimes', () => {
  test('the vitest fixture test and the pytest fixture test are both committed', () => {
    // AC-04: "a licence test enforces it on both runtimes" (L-CAD-04).
    expect(exists('tests/scripts/licence-ban.test.ts')).toBe(true);
    expect(exists('cad/tests/test_licence.py')).toBe(true);
  });
});

describe('AC-08 — checkup reports the uv and cad-python pins', () => {
  test('a healthy machine reports ok uv-pin and ok cad-python-pin', () => {
    // AC-08: both facts come from scripts/checkup.d/20-uv.mjs.
    const result = run('pnpm', ['checkup']);

    expect(result.stdout, result.output).toMatch(/^ok uv-pin — \S/m);
    expect(result.stdout, result.output).toMatch(/^ok cad-python-pin — \S/m);
  }, 900_000);

  test('CHECKUP_UV_VERSION=0.0.1 fails uv-pin exactly, and the other facts still report', () => {
    // AC-08: the uv pin is an exact match against cad/.uv-version; checkup is
    // never fail-fast, so every other fact still has its line.
    const result = run('pnpm', ['checkup'], { env: { CHECKUP_UV_VERSION: '0.0.1' } });

    expect(result.status, result.output).toBe(1);
    expect(result.stdout).toMatch(/^FAIL uv-pin\b/m);
    for (const fact of ['node-pin', 'pnpm-pin', 'cad-python-pin']) {
      expect(result.stdout, `fact ${fact} must still report`).toMatch(
        new RegExp(`^(ok|FAIL)\\s+${fact}\\b`, 'm'),
      );
    }
  }, 900_000);
});
