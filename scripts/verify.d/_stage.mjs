/**
 * Shared plumbing for verify stages: run one command, inherit its output, exit
 * with its status. Files starting with `_` are not stages (the runner only
 * takes `*.mjs`, and every real stage is numbered).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** Verification never touches the dev server's build output. */
export const VERIFY_DIST_DIR = '.next-verify';

export function runStage(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NEXT_DIST_DIR: VERIFY_DIST_DIR, CI: '1', ...env },
  });
  process.exit(result.status ?? 1);
}
