/**
 * AC-07 — the toolchain is pinned, strictly typed, and free of range specifiers.
 * Reads the config files as data; no product source is imported.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../support/proc';

const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

/** tsconfig.json is JSONC; strip comments before parsing. */
function readJsonc(relativePath: string): Record<string, unknown> {
  const stripped = read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(stripped) as Record<string, unknown>;
}

describe('AC-07 pinned toolchain', () => {
  it('tsconfig.json enables strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes', () => {
    const tsconfig = readJsonc('tsconfig.json');
    const compilerOptions = tsconfig['compilerOptions'] as Record<string, unknown> | undefined;
    expect(compilerOptions, 'tsconfig.json must declare compilerOptions').toBeDefined();
    expect(compilerOptions?.['strict']).toBe(true);
    expect(compilerOptions?.['noUncheckedIndexedAccess']).toBe(true);
    expect(compilerOptions?.['exactOptionalPropertyTypes']).toBe(true);
  });

  it('.npmrc sets save-exact=true', () => {
    expect(read('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m);
  });

  it('.nvmrc pins Node 24', () => {
    expect(read('.nvmrc').trim()).toMatch(/^v?24(\.\d+){0,2}$/);
  });

  it('package.json packageManager pins pnpm 10 to an exact version', () => {
    const pkg = readJsonc('package.json');
    expect(String(pkg['packageManager'])).toMatch(/^pnpm@10\.\d+\.\d+(\+sha\S+)?$/);
  });

  it('every dependency is an exact version — no ^ or ~ ranges', () => {
    const pkg = readJsonc('package.json');
    const ranged: string[] = [];
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const block = (pkg[field] ?? {}) as Record<string, string>;
      for (const [name, spec] of Object.entries(block)) {
        if (!/^\d+\.\d+\.\d+/.test(spec)) ranged.push(`${field}.${name}=${spec}`);
      }
    }
    expect(ranged, 'these specifiers are not exact versions').toEqual([]);
  });

  it('package.json declares the seven contracted scripts', () => {
    const pkg = readJsonc('package.json');
    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(scripts[name], `package.json scripts.${name} is missing`).toBeTruthy();
    }
    expect(scripts['verify']).toMatch(/scripts\/verify\.mjs/);
    expect(scripts['checkup']).toMatch(/scripts\/checkup\.mjs/);
  });

  it('the declared runtime pins are Next 16 / React 19 / TypeScript 6 / ESLint 10 / Vitest 4', () => {
    const pkg = readJsonc('package.json');
    const all = {
      ...((pkg['dependencies'] ?? {}) as Record<string, string>),
      ...((pkg['devDependencies'] ?? {}) as Record<string, string>),
    };
    expect(all['next']).toMatch(/^16\./);
    expect(all['react']).toMatch(/^19\./);
    expect(all['react-dom']).toMatch(/^19\./);
    expect(all['typescript']).toMatch(/^6\./);
    expect(all['eslint']).toMatch(/^10\./);
    expect(all['vitest']).toMatch(/^4\./);
  });
});
