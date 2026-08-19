/**
 * Stage-output helpers: verify's ordering and fail-fast are observable only here.
 *
 * Which makes this a verification primitive, and B-03 forbids one that can lie.
 * Scanning the transcript for the bare word lied in both directions: `next
 * build`'s own prose ("Creating an optimized production build") read as the
 * build stage having run, and a checkout under `~/build/vextrus` turned a
 * correct fail-fast run red because eslint prints absolute paths.
 *
 * So the reader is the runner's own anchored marker — `== stage <name> ==`,
 * printed by `scripts/verify.mjs` when and only when that stage runs, and
 * parsed by the same code that prints it. One definition, one truth.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { stageLineIndex as anchoredStageLineIndex } from '../../../scripts/lib/stage.mjs';
import { repoRoot } from '../../acceptance/support/cli';

export const STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;
export type StageName = (typeof STAGES)[number];

/** Index of the line where the given stage announced itself, or -1. */
export function stageLineIndex(output: string, stage: StageName): number {
  return anchoredStageLineIndex(output, stage);
}

export function ranStage(output: string, stage: StageName): boolean {
  return stageLineIndex(output, stage) >= 0;
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
