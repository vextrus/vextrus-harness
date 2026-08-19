/**
 * V-DB's tree-level half, wired into `pnpm verify`: schema and migrations must
 * not have diverged. It needs no database — the check generates into scratch and
 * compares — so it belongs in the ordinary verify run rather than behind a
 * "if Postgres is up" condition nobody would notice was always false.
 *
 * After the vitest stage and before the build: a drifted schema is a fact about
 * the tree, and the build takes long enough that finding out afterwards is worse.
 */
import { fileURLToPath } from 'node:url';

import { runStep } from '../lib/stage.mjs';

// `fileURLToPath`, not `.pathname`: a URL's pathname is percent-encoded, so a
// checkout under a directory with a space in it would hand `runStep` a path that
// does not exist and the stage would fail for a reason that is not drift.
const step = { path: fileURLToPath(new URL('../db-drift.mjs', import.meta.url)) };
const { status, stdout, stderr } = runStep(step);

if (stdout !== '') process.stdout.write(stdout);
if (stderr !== '') process.stderr.write(stderr);

process.exitCode = status;
