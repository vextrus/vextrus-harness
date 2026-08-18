/**
 * Shared plumbing for the verify stages. It lives outside `scripts/verify.d/`
 * so the runner, which treats every file in that directory as a stage, never
 * announces it.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Verify never writes into `.next`: that belongs to `pnpm dev`. */
export const DIST_DIR_NAME = '.next-verify';
export const VERIFY_DIST_DIR = path.join(REPO_ROOT, DIST_DIR_NAME);

/** Run a local binary, inheriting stdio, and exit with its code on failure. */
export function runBin(bin, args) {
  const result = spawnSync(path.join(REPO_ROOT, 'node_modules', '.bin', bin), args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NEXT_DIST_DIR: DIST_DIR_NAME },
  });
  if (result.error !== undefined) {
    console.error(String(result.error.message));
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
