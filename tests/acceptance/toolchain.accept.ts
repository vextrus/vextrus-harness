import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './harness';

/** tsconfig.json may carry comments; strip them before JSON.parse. */
function readJsonc(relativePath: string): unknown {
  const raw = readFileSync(join(repoRoot, relativePath), 'utf8');
  const withoutComments = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(withoutComments);
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(typeof value === 'object' && value !== null).toBe(true);
  return value as Record<string, unknown>;
}

function exists(relativePath: string): boolean {
  return existsSync(join(repoRoot, relativePath));
}

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('AC-07 — pinned, strict, exact toolchain (B-03, Q-08)', () => {
  it('tsconfig.json turns on strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes', () => {
    // B-03: strongly typed. Q-08: no escape hatches left open by the compiler config.
    const compilerOptions = asRecord(asRecord(readJsonc('tsconfig.json'))['compilerOptions']);
    expect(compilerOptions['strict']).toBe(true);
    expect(compilerOptions['noUncheckedIndexedAccess']).toBe(true);
    expect(compilerOptions['exactOptionalPropertyTypes']).toBe(true);
  });

  it('.npmrc sets save-exact=true', () => {
    // B-03: boring and reproducible — installs may not drift.
    expect(exists('.npmrc')).toBe(true);
    expect(read('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m);
  });

  it('.nvmrc pins Node 24', () => {
    // V-CHECKUP: node pin is a machine fact, so the pin file must exist and be exact.
    expect(exists('.nvmrc')).toBe(true);
    expect(read('.nvmrc').trim()).toMatch(/^v?24\.\d+\.\d+$/);
  });

  it('package.json packageManager pins pnpm 10 at an exact version', () => {
    const pkg = asRecord(readJsonc('package.json'));
    expect(pkg['packageManager']).toMatch(/^pnpm@10\.\d+\.\d+(\+sha\d+\.[0-9a-f]+)?$/);
  });

  it('every dependency is an exact version — no ^ or ~ ranges', () => {
    // B-03: no cache and no range that can lie.
    const pkg = asRecord(readJsonc('package.json'));
    const buckets = ['dependencies', 'devDependencies', 'optionalDependencies'];
    const offenders: string[] = [];
    for (const bucket of buckets) {
      const entry = pkg[bucket];
      if (entry === undefined) continue;
      for (const [name, range] of Object.entries(asRecord(entry))) {
        if (typeof range !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(range)) {
          offenders.push(`${bucket}.${name}=${String(range)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('package.json exposes the seven contract scripts', () => {
    const scripts = asRecord(asRecord(readJsonc('package.json'))['scripts']);
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(typeof scripts[name]).toBe('string');
    }
  });

  it('pnpm-lock.yaml is committed so --frozen-lockfile is meaningful (AC-01)', () => {
    expect(exists('pnpm-lock.yaml')).toBe(true);
  });
});

describe('AC-06 — the lint loader is discovery-based, not a hand-written list', () => {
  it('eslint.config.ts names no individual rule file', () => {
    // The whole point of the loader: later increments drop a rule in without
    // editing a shared file.
    const config = read('eslint.config.ts');
    expect(config).not.toMatch(/rules\/[a-z0-9-]+/);
    expect(config).not.toMatch(/no-forbidden-escapes/);
    expect(config).toMatch(/loadRules/);
  });
});
