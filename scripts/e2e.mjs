#!/usr/bin/env node
/**
 * The journey lane: `pnpm e2e --journey <J>` boots the app and walks a journey
 * end to end. m0-01 owns exactly one journey (J-000, scaffold-home), so the
 * flag is recorded in the transcript and every journey spec under `tests/e2e`
 * runs; later increments narrow the selection.
 */
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = argv.indexOf('--journey');
const journey = flag >= 0 ? (argv[flag + 1] ?? 'all') : 'all';

process.stdout.write(`e2e — journey ${journey}\n`);

const result = spawnSync(
  `${repoRoot}/node_modules/.bin/vitest`,
  ['run'],
  { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, VITEST_LANE: 'e2e' } },
);

process.exit(result.status ?? 1);
