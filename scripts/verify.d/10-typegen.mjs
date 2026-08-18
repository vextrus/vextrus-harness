import { runBin, VERIFY_DIST_DIR, withScratchTsconfig } from '../lib/stage.mjs';

process.exitCode = withScratchTsconfig((env) =>
  runBin('next', ['typegen'], { ...env, NEXT_DIST_DIR: VERIFY_DIST_DIR }),
);
