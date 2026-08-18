/** Stage-output helpers: verify's ordering and fail-fast are observable only here. */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { repoRoot } from '../../acceptance/support/cli';

export const STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;
export type StageName = (typeof STAGES)[number];

/** Index of the first output line that announces the given stage, or -1. */
export function stageLineIndex(output: string, stage: StageName): number {
  const lines = output.split('\n');
  const pattern = new RegExp(`\\b${stage}\\b`, 'i');
  return lines.findIndex((line) => pattern.test(line));
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
