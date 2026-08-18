/** Starts and stops the Next dev server on the contract port for journey segments. */
import { spawn, type ChildProcess } from 'node:child_process';

import { repoRoot, waitFor } from '../../acceptance/support/cli';

export interface DevServer {
  readonly baseUrl: string;
  stop: () => Promise<void>;
}

async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function startDevServer(port = 3210, timeoutMs = 180_000): Promise<DevServer> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: repoRoot(),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
    detached: true,
  });

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const stop = async (): Promise<void> => {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  };

  // Give up as soon as the dev server dies, rather than polling a dead port.
  const up = await waitFor(async () => {
    if (exited) throw new Error('`pnpm dev` exited before the server answered');
    return responds(`${baseUrl}/`);
  }, timeoutMs);
  if (!up) {
    await stop();
    throw new Error(`dev server did not answer on ${baseUrl} within ${timeoutMs}ms`);
  }
  return { baseUrl, stop };
}

/** Returns the inner HTML of the single element carrying `data-testid="<id>"`. */
export function elementByTestId(html: string, testId: string): string | undefined {
  const pattern = new RegExp(
    `<([a-zA-Z][\\w-]*)([^>]*\\bdata-testid="${testId}"[^>]*)>([\\s\\S]*?)</\\1>`,
  );
  const match = pattern.exec(html);
  return match?.[3];
}

export const visibleText = (html: string): string =>
  html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
