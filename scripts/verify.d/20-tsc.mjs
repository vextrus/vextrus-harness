import { bin } from '../lib/stage.mjs';

export const name = 'tsc';

export async function run({ repoRoot }) {
  return bin(repoRoot, 'tsc', ['--noEmit', '--pretty', 'false']);
}
