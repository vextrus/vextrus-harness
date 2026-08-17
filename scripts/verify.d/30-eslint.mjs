import { bin } from '../lib/stage.mjs';

export const name = 'eslint';

export async function run({ repoRoot }) {
  // No cache: B-03 forbids a cache that can lie.
  return bin(repoRoot, 'eslint', ['.', '--no-warn-ignored', '--max-warnings', '0']);
}
