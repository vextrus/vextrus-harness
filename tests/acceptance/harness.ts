/**
 * Shared acceptance harness. Not a test file — no assertions live here.
 *
 * Proves nothing on its own; it is the plumbing used by the *.accept.ts suites
 * that prove V-VERIFY / V-CHECKUP / Q-01 / Q-08 / B-03.
 */
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Repo root: explicit override, else the git toplevel, else the nearest
 * ancestor holding package.json.
 *
 * The git toplevel comes first on purpose: before the scaffold exists there is
 * no package.json here, and pnpm would happily walk up into an unrelated parent
 * project. Anchoring on git keeps every command aimed at this repo.
 */
function resolveRepoRoot(): string {
  const override = process.env.FOREMAN_REPO_ROOT;
  if (override !== undefined && override.length > 0) return resolve(override);

  const toplevel = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const gitRoot = (toplevel.stdout ?? '').trim();
  if (toplevel.status === 0 && gitRoot.length > 0) return gitRoot;

  let dir = process.cwd();
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const repoRoot = resolveRepoRoot();

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export interface RunResult {
  status: number;
  /** stdout and stderr merged, ANSI stripped — what a human sees. */
  output: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  wallMs: number;
}

/** Run a command from the repo root and capture merged stdout+stderr. */
export function run(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; timeoutMs?: number } = {},
): RunResult {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(options.env ?? {}), CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    status: result.status ?? 1,
    output: stripAnsi(`${stdout}\n${stderr}`),
    stdout,
    stderr,
    timedOut: result.error !== undefined && Reflect.get(result.error, 'code') === 'ETIMEDOUT',
    wallMs: Date.now() - started,
  };
}

/**
 * `pnpm --dir <repoRoot> …` — pinning the directory means a missing package.json
 * fails loudly here instead of silently resolving to a parent workspace.
 */
export const pnpm = (args: string[], options?: { env?: Record<string, string>; timeoutMs?: number }): RunResult =>
  run('pnpm', ['--dir', repoRoot, ...args], options ?? {});

/** The five V-VERIFY stages this increment owns, in contract order. */
export const VERIFY_STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;

/** The eight V-CHECKUP fact names this increment owns. */
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

/**
 * A stage counts as "run" when some output line *begins* with its name
 * (an optional short symbol/indent prefix such as "▶ " or "== " is allowed).
 * Line-anchoring is what makes the AC-04 / AC-09 absence checks meaningful:
 * a summary line like "stages: typegen, tsc, eslint" cannot fake a stage.
 */
function stageLineRegex(stage: string): RegExp {
  return new RegExp(`^[^A-Za-z0-9\\n]{0,6}${stage}\\b`, 'm');
}

export function stageRan(output: string, stage: string): boolean {
  return stageLineRegex(stage).test(output);
}

/** Character offset of the stage's announcement line, or -1. */
export function stageAt(output: string, stage: string): number {
  const match = stageLineRegex(stage).exec(output);
  return match?.index ?? -1;
}

/** Lines of a checkup report, keyed by fact name. */
export function checkupFactLine(output: string, fact: string): string | undefined {
  const match = new RegExp(`^\\s*(ok|FAIL)\\s+${fact}\\b.*$`, 'm').exec(output);
  return match?.[0]?.trim();
}

export function checkupFactOk(output: string, fact: string): boolean {
  return new RegExp(`^\\s*ok\\s+${fact}\\b`, 'm').test(output);
}

export function checkupFactFailed(output: string, fact: string): boolean {
  return new RegExp(`^\\s*FAIL\\s+${fact}\\b`, 'm').test(output);
}

/** A TCP port with nothing listening on it. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port assigned'));
        return;
      }
      resolvePort(address.port);
    });
  });
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

export interface Listener {
  port: number;
  close: () => Promise<void>;
}

/** A TCP listener that accepts and immediately drops connections (a Postgres stand-in). */
export async function openListener(): Promise<Listener> {
  const server: Server = createServer((socket) => socket.destroy());
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port assigned'));
        return;
      }
      resolvePort(address.port);
    });
  });
  return {
    port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Write a scratch file inside the repo and hand back its remover. */
export function injectFile(relativePath: string, contents: string): () => void {
  const absolute = join(repoRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
  return () => rmSync(absolute, { force: true });
}

export function removeDir(relativePath: string): void {
  rmSync(join(repoRoot, relativePath), { recursive: true, force: true });
}

/**
 * Forbidden Q-08 tokens, built by concatenation so that this file — and every
 * file that imports it — stays green under the repo's own `eslint .`
 * and is never mistaken by vitest for a real test-call modifier. (AC-13)
 */
export const TOKEN = {
  anyType: `a${'ny'}`,
  tsIgnore: `@ts-${'ignore'}`,
  tsExpectError: `@ts-${'expect'}-error`,
  eslintDisable: `eslint-${'disable'}`,
  eslintDisableNextLine: `eslint-${'disable'}-next-line`,
  skip: `.s${'kip'}`,
  only: `.o${'nly'}`,
} as const;
