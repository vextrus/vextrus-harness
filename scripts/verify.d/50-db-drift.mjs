/**
 * V-VERIFY stage: schema drift (stack-drizzle, layout-db).
 *
 * A drop-in like every other stage — `scripts/verify.mjs` names no stage, it
 * discovers them — and it runs the same `pnpm db:drift` a developer runs, rather
 * than a second copy of the logic that could drift from the drift check.
 */
import { spawnSync } from 'node:child_process';

import { repoRoot } from '../lib/stage.mjs';

const result = spawnSync(process.execPath, ['scripts/db-drift.mjs'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
