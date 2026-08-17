// Shared process runner for acceptance tests.
// Forbidden Q-08 tokens are never written literally anywhere in the test tree;
// see tests/support/tokens.ts (AC-13).
import { spawnSync } from 'node:child_process';

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout and stderr concatenated — verify/checkup may use either stream. */
  readonly output: string;
}

export const repoRoot = (): string => process.cwd();

export function run(
  command: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
  timeoutMs = 300_000,
): RunResult {
  const result = spawnSync(command, [...args], {
    cwd: repoRoot(),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...extraEnv },
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { code: result.status ?? -1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

export const pnpm = (
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
  timeoutMs = 300_000,
): RunResult => run('pnpm', args, extraEnv, timeoutMs);

/** Whole-word probe for a verify stage name in the run output. */
export const sawStage = (output: string, stage: string): boolean =>
  new RegExp(`\\b${stage}\\b`).test(output);

/** Index of the first whole-word occurrence of a stage name, or -1. */
export const stageIndex = (output: string, stage: string): number => {
  const match = new RegExp(`\\b${stage}\\b`).exec(output);
  return match === null ? -1 : match.index;
};
