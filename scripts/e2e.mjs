#!/usr/bin/env node
/**
 * The journey lane. `pnpm e2e --journey <J>` runs the journey segments in
 * `tests/e2e`; the filter is by name, so a journey id selects its segments once
 * more than one exists. At M0 the only journey is J-000 (scaffold-home).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const journeyIndex = args.findIndex((arg) => arg === '--journey' || arg.startsWith('--journey='));
let journey;
if (journeyIndex !== -1) {
  const arg = args[journeyIndex];
  journey = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[journeyIndex + 1];
}

if (journey !== undefined && journey !== '' && !/^J-000$/i.test(journey)) {
  process.stdout.write(`no journey segments for ${journey} at M0 (only J-000 · scaffold-home)\n`);
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/e2e'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, CI: '1' },
});
process.exit(result.status ?? 1);
