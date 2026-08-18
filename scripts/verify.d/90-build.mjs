/** `next build` cold into its own distDir, so `pnpm dev`'s .next is untouched. */
import { rmSync } from 'node:fs';

import { runBin, VERIFY_DIST_DIR } from '../lib/stage.mjs';

rmSync(VERIFY_DIST_DIR, { recursive: true, force: true });
runBin('next', ['build']);
