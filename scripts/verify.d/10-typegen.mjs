import { runBin, VERIFY_DIST_DIR } from '../lib/stage.mjs';

process.exit(runBin('next', ['typegen'], { NEXT_DIST_DIR: VERIFY_DIST_DIR }));
