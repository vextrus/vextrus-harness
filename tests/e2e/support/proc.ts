import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const repoRoot = process.cwd();

/**
 * The verify/checkup journeys shell out to `pnpm verify`, which itself runs
 * vitest — which would re-run these journeys forever. Children are marked so
 * the nested layer stands down. (Risk note: bounded recursion.)
 */
export const NESTED_FLAG = 'VEXTRUS_ACCEPTANCE_NESTED';
export const isNestedRun = (): boolean => process.env[NESTED_FLAG] === '1';

export type Run = { code: number; out: string; ms: number };

export function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
  timeoutMs = 480_000,
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child: ChildProcess = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env, [NESTED_FLAG]: '1', CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const collect = (chunk: Buffer): void => {
      out += chunk.toString();
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, ms: Date.now() - started });
    });
  });
}

export const pnpm = (script: string, env: Record<string, string> = {}): Promise<Run> =>
  run('pnpm', ['run', script], env);

export const VERIFY_STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;
export type VerifyStage = (typeof VERIFY_STAGES)[number];

/** Stage names verify announced, in the order they first appear in its output. */
export function stagesAnnounced(out: string): VerifyStage[] {
  return VERIFY_STAGES.filter((stage) => stageIndex(out, stage) >= 0).sort(
    (a, b) => stageIndex(out, a) - stageIndex(out, b),
  );
}

export function stageIndex(out: string, stage: VerifyStage): number {
  const line = out
    .split('\n')
    .findIndex((l) => new RegExp(`(^|[^\\w-])${stage}([^\\w-]|$)`).test(l));
  return line;
}

/** Writes a scratch file and returns a disposer that removes it. */
export function scratch(relPath: string, contents: string): () => void {
  const abs = join(repoRoot, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
  return () => rmSync(abs, { force: true });
}
