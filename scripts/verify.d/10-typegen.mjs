import { runBin, verifyRunDir, withScratchTsconfig } from '../lib/stage.mjs';

// Into this run's own directory, never the shared `.next-verify` root: the tsc
// stage typechecks the route types written here, so a concurrent verify run must
// not be rewriting them underneath it.
const distDir = `${verifyRunDir()}/typegen`;

process.exitCode = withScratchTsconfig((env) =>
  runBin('next', ['typegen'], { ...env, NEXT_DIST_DIR: distDir }),
);
