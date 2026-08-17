import { bin } from '../lib/stage.mjs';

export const name = 'vitest';

export async function run({ repoRoot }) {
  // No watch, no cache: the run must mean the same thing every time (B-03).
  return bin(repoRoot, 'vitest', ['run', '--no-file-parallelism']);
}
