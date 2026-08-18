/**
 * Acceptance for AC-07 — Bible B-03 (boring, mainstream, strongly typed) and
 * Q-01 (no cache that can lie): the toolchain is pinned, not floating.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

/** tsconfig.json is JSON-with-comments in most scaffolds; tolerate that. */
function readJsonc(rel: string): Record<string, unknown> {
  const raw = read(rel)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw) as Record<string, unknown>;
}

const pkg = readJsonc('package.json');

describe('pinned toolchain', () => {
  // AC-07: TypeScript strictness triple.
  it('tsconfig.json enables strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes', () => {
    const tsconfig = readJsonc('tsconfig.json');
    const options = tsconfig['compilerOptions'] as Record<string, unknown> | undefined;
    expect(options).toBeDefined();
    expect(options?.['strict']).toBe(true);
    expect(options?.['noUncheckedIndexedAccess']).toBe(true);
    expect(options?.['exactOptionalPropertyTypes']).toBe(true);
  });

  // AC-07: pnpm must never widen a range on install.
  it('.npmrc sets save-exact=true', () => {
    expect(read('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m);
  });

  // AC-07: pnpm 10, exact.
  it('package.json packageManager pins pnpm 10 exactly', () => {
    expect(pkg['packageManager']).toMatch(/^pnpm@10\.\d+\.\d+(\+sha[\w.-]+)?$/);
  });

  // AC-07: Node 24 LTS.
  it('.nvmrc pins Node 24', () => {
    expect(read('.nvmrc').trim()).toMatch(/^v?24(\.\d+){0,2}$/);
  });

  // AC-07: every dependency is an exact version, no ^ or ~.
  it('every dependency and devDependency is an exact version', () => {
    const fields = ['dependencies', 'devDependencies'] as const;
    const floating: string[] = [];
    for (const field of fields) {
      const deps = (pkg[field] ?? {}) as Record<string, string>;
      for (const [name, range] of Object.entries(deps)) {
        if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(range)) {
          floating.push(`${field}.${name}=${range}`);
        }
      }
    }
    expect(floating).toEqual([]);
  });

  // Interfaces: package.json scripts.
  it('exposes the seven contract scripts', () => {
    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(Object.keys(scripts)).toContain(name);
    }
    // The two verification entry points must delegate to the owned scripts.
    expect(scripts['verify']).toContain('scripts/verify.mjs');
    expect(scripts['checkup']).toContain('scripts/checkup.mjs');
    // pnpm dev must serve the contract port 3210.
    expect(scripts['dev']).toContain('3210');
  });

  // AC-01 / V-VERIFY: the five stages exist as drop-in files whose numeric
  // prefixes order them typegen -> tsc -> eslint -> vitest -> build. Asserted as
  // "contains", never "equals": a later increment (and AC-11's fixture stage)
  // must be able to drop another file in here without editing this test.
  it('ships the five verify.d stages and the three checkup.d facts as drop-ins', () => {
    const verifyStages = readdirSync(path.join(repoRoot, 'scripts', 'verify.d')).sort();
    const expectedStages = [
      '10-typegen.mjs',
      '20-tsc.mjs',
      '30-eslint.mjs',
      '40-vitest.mjs',
      '90-build.mjs',
    ];
    for (const stage of expectedStages) expect(verifyStages).toContain(stage);
    // Filename order is the execution order the whole design rests on.
    const ordered = expectedStages.map((s) => verifyStages.indexOf(s));
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i] ?? -1).toBeGreaterThan(ordered[i - 1] ?? -1);
    }

    const checkupFacts = readdirSync(path.join(repoRoot, 'scripts', 'checkup.d')).sort();
    for (const fact of ['10-node-pnpm.mjs', '30-postgres.mjs', '40-ports-env.mjs']) {
      expect(checkupFacts).toContain(fact);
    }
  });
});
