import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot, runBin, VERIFY_DIST_DIR, withScratchTsconfig } from '../lib/stage.mjs';

// Cold every time, never the dev server's directory — and never a directory a
// second concurrent `pnpm verify` is building into: two runs against one
// worktree must not destroy each other, so the build output is per-process.
const distDir = join(VERIFY_DIST_DIR, `build-${process.pid}`);
const absolute = join(repoRoot, distDir);
const clean = () => rmSync(absolute, { recursive: true, force: true });

clean();
let status = 1;
try {
  status = withScratchTsconfig((env) => runBin('next', ['build'], { ...env, NEXT_DIST_DIR: distDir }));
} finally {
  clean();
}
process.exitCode = status;
