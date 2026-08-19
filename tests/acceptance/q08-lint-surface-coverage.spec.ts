/**
 * Q-08 over every surface the repo executes or compiles.
 *
 * The escape-hatch ban is registered twice — `no-forbidden-escapes` over
 * `**​/*.ts` / `**​/*.tsx`, and its companion over `**​/*.mjs` / `**​/*.cjs` /
 * `**​/*.js` — and between them they miss `.mts` and `.cts`. Those are not
 * hypothetical extensions here: `tsconfig.json` includes `*.mts` and
 * `eslint.config.ts` puts `**​/*.mts` under the typed-linting block, so an
 * `.mts` file is a first-class, compiled, linted source file of this repo — with
 * the Q-08 guardrail switched off over it.
 *
 * Proven directly: the same two lines (a lint-suppression comment) written to
 * `probe.ts` and `probe.mjs` are reported by `vextrus/no-forbidden-escapes`;
 * written to `probe.mts` they are not reported at all.
 *
 * The registration globs are the contract, so this reads them rather than the
 * rule's behaviour: an extension the repo compiles must be an extension a Q-08
 * registration lints.
 */
import { describe, expect, test } from 'vitest';

import { loadRules } from '../../src/lint/loader';

/** Extensions the repo's own tsconfig/eslint config treat as source. */
const COMPILED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

/** Extensions the drop-in runners and their config files are written in. */
const SCRIPT_EXTENSIONS = ['.mjs', '.cjs', '.js'] as const;

/** Whether any registration's `files` glob ends in this extension. */
const covered = (globs: readonly string[], extension: string): boolean =>
  globs.some((glob) => glob.endsWith(`*${extension}`));

describe('Q-08 leaves no unlinted source extension', () => {
  const globs = loadRules().flatMap((registration) => registration.files);

  test('every compiled extension is linted by a Q-08 registration', () => {
    for (const extension of COMPILED_EXTENSIONS) {
      expect(
        covered(globs, extension),
        `${extension} is compiled by tsconfig.json but no Q-08 registration lints it: ${globs.join(', ')}`,
      ).toBe(true);
    }
  });

  test('every script extension is linted by a Q-08 registration', () => {
    for (const extension of SCRIPT_EXTENSIONS) {
      expect(covered(globs, extension), `${extension} is unlinted`).toBe(true);
    }
  });
});
