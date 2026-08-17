import { bin } from '../lib/stage.mjs';

export const name = 'typegen';

export async function run({ repoRoot }) {
  // Into verify's own distDir, like the build stage: a verify run must never
  // write into `.next`, which belongs to `pnpm dev`.
  return bin(repoRoot, 'next', ['typegen'], { env: { NEXT_DIST_DIR: '.next-verify' } });
}
