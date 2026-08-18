import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot, runBin, VERIFY_DIST_DIR } from '../lib/stage.mjs';

// Cold every time, and never the dev server's directory.
rmSync(join(repoRoot, VERIFY_DIST_DIR), { recursive: true, force: true });

process.exit(runBin('next', ['build'], { NEXT_DIST_DIR: VERIFY_DIST_DIR }));
