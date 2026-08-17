import { bin } from '../lib/stage.mjs';

export const name = 'build';

export async function run({ repoRoot }) {
  // Its own distDir: a cold build here must never poison (or be poisoned by)
  // a running `pnpm dev`.
  return bin(repoRoot, 'next', ['build'], { env: { NEXT_DIST_DIR: '.next-verify' } });
}
