/** Stage-output helpers: verify's ordering and fail-fast are observable only here. */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  ranStage as ranStageAnchored,
  stageLineIndex as stageLineIndexAnchored,
} from '../../../scripts/lib/stage.mjs';
import { repoRoot } from '../../acceptance/support/cli';

export const STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;
export type StageName = (typeof STAGES)[number];

/**
 * Stage detection is the runner's own primitive, imported rather than re-guessed.
 *
 * A stage announces itself on one anchored marker line (`== stage <name> ==`),
 * and reading fail-fast off anything looser lies: a word-boundary match for
 * `build` finds Next's "Creating an optimized production build", and one for
 * `eslint` finds a tsc diagnostic naming `typescript-eslint`. Either turns a
 * correct fail-fast run into a false "that stage ran" — so AC-04/AC-05 would
 * pass while the contract they check was broken. `scripts/lib/stage.mjs` owns
 * the marker and prints it; the same module decides here what counts as read.
 */

/** Index of the line where the given stage announced itself, or -1. */
export function stageLineIndex(output: string, stage: StageName): number {
  return stageLineIndexAnchored(output, stage);
}

export function ranStage(output: string, stage: StageName): boolean {
  return ranStageAnchored(output, stage);
}

/** Writes a scratch file into the repo and returns its remover. */
export function inject(relativePath: string, contents: string): () => void {
  const absolute = join(repoRoot(), relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
  return () => {
    rmSync(absolute, { force: true });
  };
}

/**
 * Forbidden tokens are assembled at runtime so this source stays green under
 * the repo's own `eslint .` (AC-13 / risk note 1).
 */
export const TOKENS = {
  tsIgnore: `@ts-${'ignore'}`,
  tsExpectError: `@ts-${'expect'}-error`,
  eslintDisable: `eslint-${'disable'}`,
  only: `.${'only'}`,
  skip: `.${'skip'}`,
  any: `a${'ny'}`,
} as const;
