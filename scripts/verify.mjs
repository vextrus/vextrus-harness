#!/usr/bin/env node
/**
 * V-VERIFY. Runs `scripts/verify.d/*.mjs` in filename order, fail-fast; the
 * exit code is the whole contract and the wall time is always printed.
 *
 * A later increment adds a stage by dropping a file in — nothing here changes.
 * `VERIFY_ONLY=<prefix>` narrows the run to one stage while debugging.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '..');
const stagesDir = path.join(scriptsDir, 'verify.d');

/** `10-typegen.mjs` announces itself as `typegen`. */
const stageName = (file) => file.replace(/^\d+[-_]?/, '').replace(/\.mjs$/, '');

const only = process.env.VERIFY_ONLY ?? '';
const startedAt = Date.now();
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1);

const stages = readdirSync(stagesDir)
  .filter((file) => file.endsWith('.mjs'))
  .sort();

for (const file of stages) {
  const name = stageName(file);
  if (only !== '' && !file.startsWith(only) && !name.startsWith(only)) continue;

  console.log(`== ${name}`);
  const result = spawnSync(process.execPath, [path.join(stagesDir, file)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  const code = result.status ?? 1;
  if (code !== 0) {
    console.log(`verify failed in ${name} (exit ${code}) after total ${elapsed()}s`);
    process.exit(code);
  }
}

console.log(`total ${elapsed()}s`);
