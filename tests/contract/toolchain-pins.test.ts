/**
 * The pinned toolchain is part of the contract, not a preference.
 *
 * Proves: B-03 (boring, mainstream, strongly typed), Q-08 (a loose `any` cannot
 * hide behind a loose tsconfig), AC-07 and the package.json script surface named
 * in the increment's interfaces.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './support/cli';

const ROOT = repoRoot();
const readRoot = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

/** tsconfig.json is JSONC by convention; strip comments before parsing. */
function readJsonc(file: string): Record<string, unknown> {
  const text = readRoot(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('tsconfig.json', () => {
  // AC-07 · Q-08: the three strictness flags the Bible relies on.
  it('AC-07: enables strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes', () => {
    const options = readJsonc('tsconfig.json')['compilerOptions'] as Record<string, unknown>;
    expect(options['strict']).toBe(true);
    expect(options['noUncheckedIndexedAccess']).toBe(true);
    expect(options['exactOptionalPropertyTypes']).toBe(true);
  });

  // AC-10 · Q-01: no cache that can lie — tsc must not run incrementally.
  it('AC-07: does not enable incremental compilation', () => {
    const options = readJsonc('tsconfig.json')['compilerOptions'] as Record<string, unknown>;
    expect(options['incremental']).not.toBe(true);
  });
});

describe('package manager and runtime pins', () => {
  // AC-07: Node 24 LTS pinned in .nvmrc.
  it('AC-07: .nvmrc pins Node 24', () => {
    expect(readRoot('.nvmrc').trim()).toMatch(/^v?24(\.\d+){0,2}$/);
  });

  // AC-07: pnpm 10 pinned exactly via packageManager (corepack).
  it('AC-07: packageManager pins pnpm 10 to an exact version', () => {
    const pkg = JSON.parse(readRoot('package.json')) as { packageManager?: string };
    expect(pkg.packageManager).toMatch(/^pnpm@10\.\d+\.\d+$/);
  });

  // AC-07: save-exact so a future install cannot drift a dependency.
  it('AC-07: .npmrc sets save-exact=true', () => {
    expect(readRoot('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m);
  });

  // AC-07: no range specifiers anywhere in the dependency graph roots.
  it('AC-07: every dependency is an exact version (no ^ or ~)', () => {
    const pkg = JSON.parse(readRoot('package.json')) as Record<string, unknown>;
    const blocks = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
    const loose: string[] = [];
    for (const block of blocks) {
      const deps = (pkg[block] ?? {}) as Record<string, string>;
      for (const [name, range] of Object.entries(deps)) {
        if (/^[\^~]/.test(range) || range === '*' || range === 'latest') {
          loose.push(`${block}.${name}=${range}`);
        }
      }
    }
    expect(loose).toEqual([]);
  });

  // Declared dependencies of this increment (B-03: one app, boring stack).
  it('AC-07: pins the declared toolchain majors', () => {
    const pkg = JSON.parse(readRoot('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(all['next']).toMatch(/^16\./);
    expect(all['react']).toMatch(/^19\./);
    expect(all['react-dom']).toMatch(/^19\./);
    expect(all['typescript']).toMatch(/^6\./);
    expect(all['eslint']).toMatch(/^10\./);
    expect(all['vitest']).toMatch(/^4\./);
  });
});

describe('package.json scripts', () => {
  // Interfaces: the seven entry points every later increment relies on.
  it('AC-01 · AC-02: declares dev, build, test, verify, checkup, lint, typecheck', () => {
    const pkg = JSON.parse(readRoot('package.json')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(Object.keys(scripts)).toContain(name);
    }
    // V-VERIFY / V-CHECKUP are the two runners, not inlined command chains.
    expect(scripts['verify']).toMatch(/scripts\/verify\.mjs/);
    expect(scripts['checkup']).toMatch(/scripts\/checkup\.mjs/);
    // The dev server owns port 3210 (Bible <dev>: web on 3210).
    expect(scripts['dev']).toMatch(/3210/);
  });
});

describe('drop-in stage directories', () => {
  // V-VERIFY · AC-11: stages are files in a directory, discovered by name order.
  it('AC-11: ships the five verify stages as ordered drop-in files', () => {
    for (const stage of [
      '10-typegen.mjs',
      '20-tsc.mjs',
      '30-eslint.mjs',
      '40-vitest.mjs',
      '90-build.mjs',
    ]) {
      expect(existsSync(path.join(ROOT, 'scripts', 'verify.d', stage))).toBe(true);
    }
  });

  // V-CHECKUP · AC-11: same drop-in property for the machine report.
  it('AC-11: ships the checkup facts as drop-in files', () => {
    for (const fact of ['10-node-pnpm.mjs', '30-postgres.mjs', '40-ports-env.mjs']) {
      expect(existsSync(path.join(ROOT, 'scripts', 'checkup.d', fact))).toBe(true);
    }
  });
});
