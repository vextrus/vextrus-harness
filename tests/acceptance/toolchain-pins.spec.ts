/**
 * Acceptance for the pinned toolchain (AC-07) and the scripts contract (AC-01/AC-02).
 *
 * These read the committed config files: a pin that is not in the tree is not a pin.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const repoRoot = process.cwd();

function read(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

/** Minimal JSONC reader: tsconfig.json is allowed comments and trailing commas. */
function readJsonc(relative: string): Record<string, unknown> {
  const raw = read(relative);
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? '';
    const next = raw[i + 1] ?? '';
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next;
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  const parsed: unknown = JSON.parse(out.replace(/,\s*(?=[}\]])/g, ''));
  return parsed as Record<string, unknown>;
}

function packageJson(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(read('package.json'));
  return parsed as Record<string, unknown>;
}

function record(value: unknown): Record<string, string> {
  return (value ?? {}) as Record<string, string>;
}

describe('AC-07 — pinned toolchain', () => {
  test('.nvmrc pins Node 24', () => {
    expect(read('.nvmrc').trim()).toMatch(/^v?24(\.\d+){0,2}$/);
  });

  test('package.json packageManager pins pnpm 10 to an exact version', () => {
    const pm = packageJson()['packageManager'];
    expect(typeof pm).toBe('string');
    expect(pm).toMatch(/^pnpm@10\.\d+\.\d+(\+sha[\w.-]+)?$/);
  });

  test('.npmrc sets save-exact=true', () => {
    expect(read('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m);
  });

  test('every dependency is an exact version — no ^ or ~ ranges', () => {
    const pkg = packageJson();
    const all = {
      ...record(pkg['dependencies']),
      ...record(pkg['devDependencies']),
    };
    expect(Object.keys(all).length).toBeGreaterThan(0);
    for (const [name, range] of Object.entries(all)) {
      expect(`${name}@${range}`).toMatch(/@\d+\.\d+\.\d+(-[\w.]+)?$/);
    }
  });

  test('tsconfig.json enables strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes', () => {
    const compilerOptions = record(readJsonc('tsconfig.json')['compilerOptions']);
    expect(compilerOptions['strict']).toBe(true);
    expect(compilerOptions['noUncheckedIndexedAccess']).toBe(true);
    expect(compilerOptions['exactOptionalPropertyTypes']).toBe(true);
  });

  test('the declared framework and tooling majors match the Bible pins', () => {
    const pkg = packageJson();
    const all = {
      ...record(pkg['dependencies']),
      ...record(pkg['devDependencies']),
    };
    const majorOf = (name: string): number => Number.parseInt(all[name] ?? '', 10);
    expect(majorOf('next')).toBe(16);
    expect(majorOf('react')).toBe(19);
    expect(majorOf('react-dom')).toBe(19);
    expect(majorOf('typescript')).toBe(6);
    expect(majorOf('eslint')).toBe(10);
    expect(majorOf('vitest')).toBe(4);
  });
});

describe('AC-01/AC-02 — the entry points every later increment extends', () => {
  test('package.json declares dev, build, test, verify, checkup, lint and typecheck', () => {
    const scripts = record(packageJson()['scripts']);
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(Object.keys(scripts)).toContain(name);
    }
    expect(scripts['verify']).toMatch(/scripts\/verify\.mjs/);
    expect(scripts['checkup']).toMatch(/scripts\/checkup\.mjs/);
    expect(scripts['dev']).toMatch(/3210/);
    expect(scripts['test']).toMatch(/vitest run/);
  });

  test('the five verify stages exist as drop-in files in filename order', () => {
    for (const stage of [
      'scripts/verify.d/10-typegen.mjs',
      'scripts/verify.d/20-tsc.mjs',
      'scripts/verify.d/30-eslint.mjs',
      'scripts/verify.d/40-vitest.mjs',
      'scripts/verify.d/90-build.mjs',
    ]) {
      expect(existsSync(join(repoRoot, stage))).toBe(true);
    }
  });

  test('verify.mjs discovers its stages instead of listing them', () => {
    const runner = read('scripts/verify.mjs');
    expect(runner).toMatch(/verify\.d/);
    expect(runner).not.toMatch(/10-typegen/);
    expect(runner).not.toMatch(/90-build/);
  });

  test('the checkup facts exist as drop-in files and checkup.mjs discovers them', () => {
    for (const fact of [
      'scripts/checkup.d/10-node-pnpm.mjs',
      'scripts/checkup.d/30-postgres.mjs',
      'scripts/checkup.d/40-ports-env.mjs',
    ]) {
      expect(existsSync(join(repoRoot, fact))).toBe(true);
    }
    const runner = read('scripts/checkup.mjs');
    expect(runner).toMatch(/checkup\.d/);
    expect(runner).not.toMatch(/10-node-pnpm/);
  });

  test('AC-06 — the named fixture test files ship with the rule and the loader', () => {
    expect(existsSync(join(repoRoot, 'src/lint/__tests__/no-forbidden-escapes.test.ts'))).toBe(true);
    expect(existsSync(join(repoRoot, 'src/lint/__tests__/loader.test.ts'))).toBe(true);
  });
});
