/**
 * Shared plumbing for the drop-in runners. Deliberately outside `verify.d/` and
 * `checkup.d/`, so it is never mistaken for a stage or a fact.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The distDir `pnpm verify` builds into; never the dev server's `.next`. */
export const VERIFY_DIST_DIR = '.next-verify';

/** `10-typegen.mjs` -> `typegen`: the number orders, the name is what gets printed. */
export const stepName = (file) => file.replace(/\.mjs$/, '').replace(/^\d+[-_]/, '');

/** Every `*.mjs` in the drop-in directory, in filename order. */
export function discoverSteps(directory) {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.mjs'))
    .sort()
    .map((file) => ({ file, name: stepName(file), path: join(directory, file) }));
}

/** Runs a drop-in step as its own process so any `.mjs` file works as a step. */
export function runStep(step, env = {}) {
  const result = spawnSync(process.execPath, [step.path], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Runs a local binary from `node_modules/.bin`, inheriting stdio. */
export function runBin(binary, args, env = {}) {
  const bin = join(repoRoot, 'node_modules', '.bin', binary);
  const result = spawnSync(bin, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export const seconds = (startedAt) => ((Date.now() - startedAt) / 1000).toFixed(1);
