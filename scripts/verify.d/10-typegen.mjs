/** `next typegen` into verify's own distDir, cold: the directory is wiped first. */
import { rmSync } from 'node:fs';

import { runBin, VERIFY_DIST_DIR } from '../lib/stage.mjs';

rmSync(VERIFY_DIST_DIR, { recursive: true, force: true });
runBin('next', ['typegen']);
