/**
 * V-DB / stack-drizzle: `pnpm verify` refuses a tree whose schema and migrations
 * disagree. It is a statement about the tree — no database is touched — so it
 * belongs in the verify run rather than in the live lane.
 *
 * A drop-in like every other stage: the runner names no stage, and this one
 * announces itself through the shared marker by simply being here.
 */
import { join } from 'node:path';

import { repoRoot, runStep } from '../lib/stage.mjs';

const drift = { path: join(repoRoot, 'scripts', 'db-drift.mjs') };
const { status, stdout, stderr } = runStep(drift);

// The verdict is the transcript's business only when there is something to say:
// the runner prints a failing stage's output under that stage's line, so the
// DRIFT marker reaches the reader without a green run printing anything at all.
if (status !== 0) {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}
process.exitCode = status;
