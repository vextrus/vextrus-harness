/**
 * Test support for the CLI contract tests (no product source imported).
 *
 * The verify/checkup entry points are processes, so acceptance drives them as
 * processes. Bible: V-VERIFY ("exit code is the whole contract"), V-CHECKUP.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Stage names the verify runner must print, in order (V-VERIFY). */
export const VERIFY_STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;
export type VerifyStage = (typeof VERIFY_STAGES)[number];

/** The eight checkup fact names (interfaces: scripts/checkup.mjs). */
export const CHECKUP_FACTS = [
  'node-pin',
  'pnpm-pin',
  'uv-present',
  'postgres-5544',
  'port-3210',
  'port-3211',
  'storage-root',
  'env',
] as const;
export type CheckupFact = (typeof CHECKUP_FACTS)[number];

/**
 * Repo root, found by walking up to the Bible, which is committed and never
 * moves — so this resolves even on a tree where nothing is built yet.
 */
export function repoRoot(): string {
  let dir = import.meta.dirname;
  for (;;) {
    if (existsSync(path.join(dir, 'docs', 'specs', 'vextrus.spec.xml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('repo root not found (docs/specs/vextrus.spec.xml missing)');
    dir = parent;
  }
}

export type RunResult = {
  status: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr, what a human sees in the terminal. */
  output: string;
  ms: number;
};

/**
 * Reentrancy guard. `pnpm verify` runs `vitest run`, which may pick this suite
 * up again; spawns below mark their children, and tests that drive verify use
 * `nestedInVerify()` to avoid an unbounded recursion of builds.
 */
export function nestedInVerify(): boolean {
  return process.env.VEXTRUS_ACCEPTANCE_NESTED === '1';
}

export function run(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): RunResult {
  const started = Date.now();
  const child = spawnSync(command, [...args], {
    cwd: repoRoot(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, VEXTRUS_ACCEPTANCE_NESTED: '1', CI: '1', ...env },
  });
  const stdout = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  return {
    status: child.status ?? 1,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
    ms: Date.now() - started,
  };
}

export function runVerify(env: Readonly<Record<string, string>> = {}): RunResult {
  return run('pnpm', ['verify'], env);
}

export function runCheckup(env: Readonly<Record<string, string>> = {}): RunResult {
  return run('pnpm', ['checkup'], env);
}

/**
 * Stage names as the run announced them, in the order they appeared. Absence of
 * a stage here is how fail-fast is observed (AC-04, AC-09).
 */
export function announcedStages(output: string): VerifyStage[] {
  const seen: VerifyStage[] = [];
  for (const line of output.split('\n')) {
    for (const stage of VERIFY_STAGES) {
      if (new RegExp(`\\b${stage}\\b`).test(line) && !seen.includes(stage)) seen.push(stage);
    }
  }
  return seen;
}

/** The `ok <fact> — detail` / `FAIL <fact> — detail` line for one fact. */
export function factLine(output: string, fact: string): string | undefined {
  return output
    .split('\n')
    .map((l) => l.trim())
    .find((l) => new RegExp(`^(ok|FAIL)\\s+${fact}\\b`).test(l));
}
