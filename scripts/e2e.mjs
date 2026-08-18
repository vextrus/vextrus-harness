#!/usr/bin/env node
/**
 * The journey lane. `pnpm e2e --journey <J>` runs the journey segments under
 * tests/e2e with their own vitest config; they spawn `pnpm verify`, `pnpm
 * checkup` and `pnpm dev` as child processes, so they never run inside verify.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const journeyIndex = args.indexOf('--journey');
const journey = journeyIndex >= 0 ? (args[journeyIndex + 1] ?? '') : '';
if (journey !== '') console.log(`e2e journey ${journey}`);

const result = spawnSync(
  path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
  ['run', '--config', 'tests/e2e/vitest.e2e.config.ts'],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
