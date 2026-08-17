/**
 * Journey support: boots the real app the way a human does (`pnpm dev` on 3210)
 * and tears it down cleanly. No browser driver — the e2e lane (pnpm e2e, port
 * 3211) is a later increment; this segment only needs the served document.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEV_PORT = 3210;
export const DEV_ORIGIN = `http://127.0.0.1:${DEV_PORT}`;

export function repoRoot(): string {
  let dir = import.meta.dirname;
  for (;;) {
    if (existsSync(path.join(dir, 'docs', 'specs', 'vextrus.spec.xml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('repo root not found');
    dir = parent;
  }
}

export type DevServer = { stop: () => Promise<void>; log: () => string };

export async function startDevServer(timeoutMs = 120_000): Promise<DevServer> {
  const child: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: repoRoot(),
    env: { ...process.env, PORT: String(DEV_PORT), BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });

  const stop = async (): Promise<void> => {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  };

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) {
      await stop();
      throw new Error(`pnpm dev exited with ${String(child.exitCode)}:\n${log}`);
    }
    try {
      const response = await fetch(`${DEV_ORIGIN}/`, { redirect: 'follow' });
      if (response.status < 500) return { stop, log: () => log };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`dev server never answered on ${DEV_ORIGIN}:\n${log}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  }
}
