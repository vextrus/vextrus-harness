import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot, runBin, verifyRunDir, withScratchTsconfig } from '../lib/stage.mjs';

// Cold every time, never the dev server's directory — and never a directory a
// second concurrent `pnpm verify` is building into: two runs against one
// worktree must not destroy each other, so the build output lives in this run's
// own directory, the same one the typegen stage wrote its route types into.
const distDir = `${verifyRunDir()}/build`;
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
