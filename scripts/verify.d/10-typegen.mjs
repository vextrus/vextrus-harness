import { runBin, VERIFY_DIST_DIR, withTsconfigPreserved } from '../lib/stage.mjs';

process.exit(
  withTsconfigPreserved(() => runBin('next', ['typegen'], { NEXT_DIST_DIR: VERIFY_DIST_DIR })),
);
