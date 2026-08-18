import { runBin } from '../lib/stage.mjs';

// Q-01 / B-03: no cache that can lie.
process.exitCode = runBin('vitest', ['run', '--no-cache']);
