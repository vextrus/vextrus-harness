/**
 * V-VERIFY stage 5: a cold `next build` into its own distDir.
 *
 * The directory is wiped first: Q-01 allows no cache that can lie, and the dev
 * server's `.next` must come out of a verification byte-identical.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';

import { ROOT, VERIFY_DIST_DIR, runStage } from './_stage.mjs';

rmSync(path.join(ROOT, VERIFY_DIST_DIR), { recursive: true, force: true });

runStage('pnpm', ['exec', 'next', 'build']);
