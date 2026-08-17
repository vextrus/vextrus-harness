// AC-07 / B-03 — the pinned toolchain is a file-level contract: strict TS,
// exact versions everywhere, Node 24 and pnpm 10 pinned in-repo.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../support/run';

const read = (relative: string): string => readFileSync(join(repoRoot(), relative), 'utf8');

const stripJsonComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

interface TsConfig {
  readonly compilerOptions?: Record<string, unknown>;
}
interface PackageJson {
  readonly packageManager?: string;
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const packageJson = (): PackageJson => JSON.parse(read('package.json')) as PackageJson;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

describe('pinned toolchain', () => {
  it('pins Node 24 in .nvmrc', () => {
    // AC-07 — Node 24 LTS.
    expect(read('.nvmrc').trim()).toMatch(/^v?24(?:\.\d+){0,2}$/);
  });

  it('pins an exact pnpm 10 via packageManager', () => {
    // AC-07 — pnpm 10, exact.
    const pinned = packageJson().packageManager ?? '';
    expect(pinned).toMatch(/^pnpm@10\.\d+\.\d+(?:\+sha[0-9a-z.-]+)?$/);
  });

  it('sets save-exact in .npmrc', () => {
    // AC-07 — no drifting ranges on future installs.
    expect(read('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m);
  });

  it('declares every dependency at an exact version', () => {
    // AC-07 / B-03 — no `^`, no `~`, no ranges.
    const pkg = packageJson();
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(all).length).toBeGreaterThan(0);
    const loose = Object.entries(all).filter(([, spec]) => !EXACT_VERSION.test(spec));
    expect(loose).toEqual([]);
  });

  it('enables strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes', () => {
    // AC-07 / B-03 — strongly typed by construction.
    const tsconfig = JSON.parse(stripJsonComments(read('tsconfig.json'))) as TsConfig;
    const options = tsconfig.compilerOptions ?? {};
    expect(options['strict']).toBe(true);
    expect(options['noUncheckedIndexedAccess']).toBe(true);
    expect(options['exactOptionalPropertyTypes']).toBe(true);
  });

  it('exposes the seven contracted package scripts', () => {
    // AC-01 / AC-02 — the entry points every later increment extends.
    const scripts = packageJson().scripts ?? {};
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(Object.keys(scripts)).toContain(name);
    }
    expect(scripts['verify']).toContain('scripts/verify.mjs');
    expect(scripts['checkup']).toContain('scripts/checkup.mjs');
  });

  it('ships a lockfile whose specifiers match package.json exactly', () => {
    // AC-01 — this is what makes `pnpm install --frozen-lockfile` succeed on a
    // clean checkout; asserted against the files so it holds offline too.
    expect(existsSync(join(repoRoot(), 'pnpm-lock.yaml'))).toBe(true);
    const lock = read('pnpm-lock.yaml');
    const pkg = packageJson();
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const missing = Object.entries(all).filter(([name, spec]) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      return !new RegExp(`(^|\\s)'?${escaped}'?:\\s*\\n\\s*specifier:\\s*${spec}\\s*\\n`, 'm').test(lock);
    });
    expect(missing.map(([name]) => name)).toEqual([]);
  });

  it('keeps both build output directories out of git', () => {
    // AC-10 — .next and .next-verify are build artefacts, never committed.
    const ignore = read('.gitignore');
    expect(ignore).toMatch(/^\.next(\/|$)/m);
    expect(ignore).toMatch(/^\.next-verify(\/|$)/m);
  });
});
