import { bin } from '../lib/stage.mjs';

export const name = 'vitest';

export async function run({ repoRoot }) {
  // No watch, no cache: the run must mean the same thing every time (B-03).
  // The lane is pinned rather than inherited: this stage runs the unit suites,
  // whatever lane the process that invoked verify happened to be running.
  return bin(repoRoot, 'vitest', ['run', '--no-file-parallelism'], { env: { VITEST_LANE: 'unit' } });
}
