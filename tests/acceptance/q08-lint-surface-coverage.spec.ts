/**
 * Q-08 over every surface this increment adds to the repo's compile set.
 *
 * The escape-hatch ban is registered twice — `no-forbidden-escapes` over
 * `**​/*.ts` / `**​/*.tsx`, and its companion over `**​/*.mjs` / `**​/*.cjs` /
 * `**​/*.js`. Between them they miss `.mts` and `.cts`, and `tsconfig.json`
 * already included `*.mts` before this lane started: that hole is a property of
 * `eslint.config.ts`, which this increment does not own, so the full-surface
 * invariant is an acceptance on the increment that owns the rule surface.
 *
 * What this lane owes is narrower and is a regression guard, deliberately green
 * at the moment it is written: the DB lane widens the compile set with
 * `db/**​/*.ts`, and a lane may not widen it with an extension no Q-08
 * registration lints. A compiled-but-unlinted file is a file where a
 * lint-suppression comment silently works, which is the lie B-03 forbids — so
 * the tsconfig delta is measured against the branch's base and every extension
 * it introduces must be an extension a registration covers.
 *
 * The registration globs are the contract, so this reads them rather than the
 * rule's behaviour.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { loadRules } from '../../src/lint/loader';

/** Extensions the drop-in runners and their config files are written in. */
const SCRIPT_EXTENSIONS = ['.mjs', '.cjs', '.js'] as const;

/** Refs this branch may have been cut from, most local first. */
const BASE_REFS = ['main', 'origin/main'] as const;

const git = (...args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** The `include` globs of a tsconfig source, as extensions (`db/**​/*.ts` → `.ts`). */
const includedExtensions = (tsconfigJson: string): Set<string> => {
  const include = (JSON.parse(tsconfigJson) as { include?: string[] }).include ?? [];
  return new Set(
    include
      .map((glob) => /\.[A-Za-z]+$/.exec(glob)?.[0])
      .filter((extension): extension is string => extension !== undefined),
  );
};

/** `tsconfig.json` as it stands on the commit this branch was cut from. */
const baseTsconfig = (): string => {
  const failures: string[] = [];
  for (const ref of BASE_REFS) {
    try {
      return git('show', `${git('merge-base', 'HEAD', ref)}:tsconfig.json`);
    } catch (error) {
      failures.push(`${ref}: ${(error as Error).message}`);
    }
  }
  throw new Error(`cannot read the base tsconfig.json from git — tried ${failures.join('; ')}`);
};

/** Whether any registration's `files` glob ends in this extension. */
const covered = (globs: readonly string[], extension: string): boolean =>
  globs.some((glob) => glob.endsWith(`*${extension}`));

describe('Q-08 leaves no unlinted source extension', () => {
  const globs = loadRules().flatMap((registration) => registration.files);

  /** B-05 / Q-08 regression guard: the compile surface may only grow into linted extensions. */
  test('this increment adds no compiled-but-unlinted extension', () => {
    const base = includedExtensions(baseTsconfig());
    const current = includedExtensions(readFileSync('tsconfig.json', 'utf8'));
    const introduced = [...current].filter((extension) => !base.has(extension));

    for (const extension of introduced) {
      expect(
        covered(globs, extension),
        `${extension} is newly compiled by tsconfig.json on this branch but no Q-08 registration lints it: ${globs.join(', ')}`,
      ).toBe(true);
    }
  });

  test('every script extension is linted by a Q-08 registration', () => {
    for (const extension of SCRIPT_EXTENSIONS) {
      expect(covered(globs, extension), `${extension} is unlinted`).toBe(true);
    }
  });
});
