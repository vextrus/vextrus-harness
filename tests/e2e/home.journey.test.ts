// Journey checkpoint `scaffold-home` — the root page at / is served by
// `pnpm dev` on port 3210 and carries the app-title heading.
import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../support/run';
import { withPortLock } from '../support/port-lock';

const DEV_PORT = 3210;
const DEV_URL = `http://127.0.0.1:${String(DEV_PORT)}/`;
const BOOT_TIMEOUT_MS = 180_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitForHome(deadline: number): Promise<Response> {
  let lastError = 'never attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(DEV_URL);
      if (response.status === 200) {
        return response;
      }
      lastError = `status ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`dev server never served ${DEV_URL}: ${lastError}`);
}

function stopDevServer(child: ChildProcess): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // no process group (already gone) — fall through to a direct kill
    }
  }
  child.kill('SIGTERM');
}

describe.sequential('checkpoint scaffold-home', () => {
  it('serves / on port 3210 with the app-title heading reading "Vextrus"', async () => {
    // AC-08 — GET / on the dev server.
    await withPortLock(async () => {
      const child = spawn('pnpm', ['dev'], {
        cwd: repoRoot(),
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, NO_COLOR: '1' },
      });
      try {
        const response = await waitForHome(Date.now() + BOOT_TIMEOUT_MS);
        const html = await response.text();

        const match = /<([a-z][a-z0-9]*)\b[^>]*\bdata-testid="app-title"[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
        expect(match, `no element carried data-testid="app-title":\n${html.slice(0, 2000)}`).not.toBeNull();

        const tagName = (match?.[1] ?? '').toLowerCase();
        expect(tagName, 'app-title must be a heading element').toMatch(/^h[1-6]$/);

        const visibleText = (match?.[2] ?? '').replace(/<[^>]*>/g, '').trim();
        expect(visibleText).toBe('Vextrus');
      } finally {
        stopDevServer(child);
        await sleep(1000);
      }
    });
  }, BOOT_TIMEOUT_MS + 60_000);
});
