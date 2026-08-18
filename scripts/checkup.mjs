#!/usr/bin/env node
/**
 * V-CHECKUP. Runs `scripts/checkup.d/*.mjs` and reports every machine fact by
 * name. Deliberately NOT fail-fast: a broken fact must never hide the ones
 * behind it. The exit code is non-zero if any fact failed.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');
const factsDir = path.join(scriptsDir, 'checkup.d');

let failed = 0;

for (const file of readdirSync(factsDir).filter((f) => f.endsWith('.mjs')).sort()) {
  const result = spawnSync(process.execPath, [path.join(factsDir, file)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if ((result.status ?? 1) !== 0) failed += 1;
}

if (failed > 0) {
  console.log(`checkup: ${failed} of ${readdirSync(factsDir).length} fact groups failed`);
  process.exit(1);
}
