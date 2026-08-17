import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

function parseJsonc(source: string): Record<string, unknown> {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  return JSON.parse(withoutComments) as Record<string, unknown>;
}

describe('pinned toolchain', () => {
  // AC-07 / B-03: strongly typed, no escape hatches at the compiler level.
  it('tsconfig enables strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes', () => {
    const tsconfig = parseJsonc(read('tsconfig.json'));
    const options = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(options['strict']).toBe(true);
    expect(options['noUncheckedIndexedAccess']).toBe(true);
    expect(options['exactOptionalPropertyTypes']).toBe(true);
  });

  // AC-07: Node 24 pinned via .nvmrc.
  it('pins Node 24 in .nvmrc', () => {
    expect(read('.nvmrc').trim()).toMatch(/^v?24(\.\d+){0,2}$/);
  });

  // AC-07: pnpm 10 pinned to an exact version via packageManager.
  it('pins pnpm 10 exactly in packageManager', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(String(pkg['packageManager'])).toMatch(/^pnpm@10\.\d+\.\d+(\+sha[\w.-]+)?$/);
  });

  // AC-07: .npmrc sets save-exact so future installs stay pinned.
  it('sets save-exact=true in .npmrc', () => {
    expect(read('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m);
  });

  // AC-07 / B-03: every dependency is an exact version, no ranges.
  it('declares every dependency at an exact version', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    const buckets = ['dependencies', 'devDependencies', 'optionalDependencies'];
    const offenders: string[] = [];
    for (const bucket of buckets) {
      const deps = (pkg[bucket] ?? {}) as Record<string, string>;
      for (const [name, range] of Object.entries(deps)) {
        if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(range)) offenders.push(`${bucket}.${name}=${range}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Test contract: the six entry points every later increment relies on.
  it('exposes the required package scripts', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    const scripts = pkg['scripts'] as Record<string, string>;
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(scripts[name], `missing script: ${name}`).toBeTruthy();
    }
    expect(scripts['verify']).toContain('scripts/verify.mjs');
    expect(scripts['checkup']).toContain('scripts/checkup.mjs');
    expect(scripts['dev']).toContain('3210');
  });

  // AC-01: a frozen lockfile is what makes the clean-checkout install reproducible.
  it('commits a pnpm lockfile', () => {
    expect(existsSync(join(repoRoot, 'pnpm-lock.yaml'))).toBe(true);
  });

  // V-VERIFY: the five stages of this increment exist as drop-in files, in order.
  it('ships the five verify stages and the checkup facts as drop-in files', () => {
    for (const stage of [
      'scripts/verify.mjs',
      'scripts/verify.d/10-typegen.mjs',
      'scripts/verify.d/20-tsc.mjs',
      'scripts/verify.d/30-eslint.mjs',
      'scripts/verify.d/40-vitest.mjs',
      'scripts/verify.d/90-build.mjs',
      'scripts/checkup.mjs',
      'scripts/checkup.d/10-node-pnpm.mjs',
      'scripts/checkup.d/30-postgres.mjs',
      'scripts/checkup.d/40-ports-env.mjs',
    ]) {
      expect(existsSync(join(repoRoot, stage)), `missing ${stage}`).toBe(true);
    }
  });
});
