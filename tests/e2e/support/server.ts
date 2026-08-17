import { spawn, type ChildProcess } from 'node:child_process';

import { NESTED_FLAG, repoRoot } from './proc';

export const DEV_PORT = 3210;
export const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;

export type DevServer = { stop: () => void; log: () => string };

/** Starts `pnpm dev` and waits until `/` answers on port 3210. */
export async function startDevServer(timeoutMs = 180_000): Promise<DevServer> {
  const child: ChildProcess = spawn('pnpm', ['run', 'dev'], {
    cwd: repoRoot,
    env: { ...process.env, [NESTED_FLAG]: '1', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout?.on('data', (c: Buffer) => (log += c.toString()));
  child.stderr?.on('data', (c: Buffer) => (log += c.toString()));

  const stop = (): void => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGKILL');
    }
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      stop();
      throw new Error(`pnpm dev exited with ${child.exitCode}:\n${log}`);
    }
    try {
      const response = await fetch(DEV_URL, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return { stop, log: () => log };
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error(`dev server did not answer on ${DEV_URL} within ${timeoutMs}ms:\n${log}`);
}
