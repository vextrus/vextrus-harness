import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repoRoot } from '../acceptance/harness';
import { openHome } from './pages/home.page';

const BASE_URL = 'http://127.0.0.1:3210';
let server: ChildProcess | undefined;
let bootLog = '';

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(new URL('/', BASE_URL));
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`dev server never answered on ${BASE_URL}\n${bootLog}`);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
}

beforeAll(async () => {
  // Contract procedure: `pnpm dev` — Next dev server on port 3210.
  server = spawn('pnpm', ['dev'], { cwd: repoRoot, detached: true, env: { ...process.env, NO_COLOR: '1' } });
  server.stdout?.on('data', (chunk: Buffer) => {
    bootLog += chunk.toString();
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    bootLog += chunk.toString();
  });
  await waitForServer(180_000);
}, 200_000);

afterAll(() => {
  const pid = server?.pid;
  if (pid !== undefined) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      server?.kill('SIGTERM');
    }
  }
});

describe('journey: scaffold-home', () => {
  it('[checkpoint: scaffold-home] AC-08 — GET / serves a heading testid=app-title reading "Vextrus"', async () => {
    const page = await openHome(BASE_URL);
    expect(page.appTitle(), page.html.slice(0, 2000)).toBe('Vextrus');
    // The screen contract calls it a heading.
    expect(page.appTitleTag()).toMatch(/^h[1-6]$/);
  });

  it('[checkpoint: scaffold-home] AC-08 — the page is titled', async () => {
    const page = await openHome(BASE_URL);
    expect(page.html).toMatch(/<title[^>]*>[\s\S]*Vextrus[\s\S]*<\/title>/i);
  });
});
