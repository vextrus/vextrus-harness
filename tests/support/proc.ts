/**
 * Shared process/journey helpers for the acceptance suite.
 * These tests drive the repo's *entry points* (`pnpm verify`, `pnpm checkup`,
 * `pnpm dev`) as a sceptical reviewer would: from the outside, by exit code
 * and by what is printed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `pnpm verify` runs `vitest run`, which would re-enter these very tests.
 * Every child we spawn carries this marker so the inner vitest run declares
 * itself nested and does not recurse. See `nested` below.
 */
export const NESTED_ENV = 'VEXTRUS_ACCEPTANCE_NESTED';
export const nested = process.env[NESTED_ENV] === '1';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  all: string;
  ms: number;
}

export function run(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<RunResult> {
  const started = Date.now();
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...options.env, [NESTED_ENV]: '1', CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 300_000);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, all: stdout + stderr, ms: Date.now() - started });
    });
  });
}

export const pnpm = (args: string[], options?: Parameters<typeof run>[2]): Promise<RunResult> =>
  run('pnpm', args, options ?? {});

/** Index of a stage name in the transcript, or -1 when the stage never announced itself. */
export function stageIndex(output: string, stage: string): number {
  return output.search(new RegExp(`\\b${stage}\\b`, 'i'));
}

export function stageRan(output: string, stage: string): boolean {
  return stageIndex(output, stage) >= 0;
}

/** Write a scratch file inside the repo, always removed again. */
export async function withScratchFile<T>(
  relativePath: string,
  contents: string,
  body: () => Promise<T>,
): Promise<T> {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
  try {
    return await body();
  } finally {
    rmSync(absolute, { force: true });
  }
}

/**
 * Cross-file mutex. Checkup binds 3210/3211 to prove they are free, and the
 * journey test holds 3210 with a dev server; without this they would lie
 * about each other.
 */
export async function acquirePortLock(): Promise<() => void> {
  const lock = path.join(tmpdir(), 'vextrus-acceptance-ports.lock');
  const deadline = Date.now() + 240_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`could not acquire port lock ${lock}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return () => rmSync(lock, { recursive: true, force: true });
}

export async function withPortLock<T>(body: () => Promise<T>): Promise<T> {
  const release = await acquirePortLock();
  try {
    return await body();
  } finally {
    release();
  }
}

/** Occupy a port so a probe against it succeeds (simulated-healthy service). */
export async function withListener<T>(body: (port: number) => Promise<T>): Promise<T> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') { reject(new Error('no port')); return; }
      resolve(address.port);
    });
  });
  try {
    return await body(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** A port that is definitely closed: bind it, read it, release it. */
export async function closedPort(): Promise<number> {
  return withListener(async (port) => port);
}

export async function waitForHttp(url: string, timeoutMs = 180_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError)}`);
}

/** Named journey checkpoint — printed so a transcript reads as a journey. */
export function checkpoint(name: string, detail: string): void {
  process.stdout.write(`checkpoint ${name} — ${detail}\n`);
}
