import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { bin } from '../lib/stage.mjs';

export const name = 'build';

const DIST_DIR = '.next-verify';

export async function run({ repoRoot }) {
  // Its own distDir, wiped first: the build must be cold every time — Next
  // persists a compile cache under <distDir>/cache, and B-03 forbids a cache
  // that can lie. It also keeps a running `pnpm dev` out of the way.
  rmSync(join(repoRoot, DIST_DIR), { recursive: true, force: true });
  return bin(repoRoot, 'next', ['build'], { env: { NEXT_DIST_DIR: DIST_DIR } });
}
