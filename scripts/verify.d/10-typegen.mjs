import { bin } from '../lib/stage.mjs';

export const name = 'typegen';

export async function run({ repoRoot }) {
  return bin(repoRoot, 'next', ['typegen']);
}
