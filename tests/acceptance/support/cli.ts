/** Shared helpers for acceptance tests that drive the repo's own entry points. */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

export interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout + stderr, for assertions that do not care which stream a line took. */
  readonly output: string;
}

export const repoRoot = (): string => process.env['FOREMAN_REPO_ROOT'] ?? process.cwd();

export function runCli(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
  timeoutMs = 240_000,
): CliResult {
  const result = spawnSync(command, [...args], {
    cwd: repoRoot(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: timeoutMs,
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

/** Holds a real TCP listener open, so a probe of this port sees a live service. */
export async function listenOnEphemeralPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port assigned'));
        return;
      }
      resolve(address.port);
    });
  });
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** A port that was bindable a moment ago and is now closed — nothing listens there. */
export async function closedPort(): Promise<number> {
  const held = await listenOnEphemeralPort();
  await held.close();
  return held.port;
}

export async function waitFor(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
