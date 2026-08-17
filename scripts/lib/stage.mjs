/**
 * Shared plumbing for verify stages. Not a stage itself — the runner only
 * picks up files whose names start with a digit ordering prefix.
 */
import { spawnSync } from 'node:child_process';

/**
 * Run a local binary and stream its output through. Returns its exit status.
 * Output is written to this process's stdout/stderr so a stage's failure text
 * lands in the transcript the acceptance suite reads.
 */
export function exec(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
    shell: false,
  });
  if (result.error !== undefined && result.error !== null) {
    process.stderr.write(`   ${command}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

/** Run a package binary from node_modules/.bin without going through pnpm. */
export function bin(repoRoot, name, args, options = {}) {
  return exec(`${repoRoot}/node_modules/.bin/${name}`, args, { cwd: repoRoot, ...options });
}
