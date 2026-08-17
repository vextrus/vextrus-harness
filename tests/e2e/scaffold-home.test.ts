/**
 * Journey checkpoint `scaffold-home` (AC-08):
 * `pnpm dev` serves `/` on port 3210 and the page carries the app-title heading.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acquirePortLock, checkpoint, NESTED_ENV, nested, repoRoot, waitForHttp } from '../support/proc';
import { HomePage } from './pages/home.page';

const BASE_URL = 'http://127.0.0.1:3210';
const BOOT_MS = 240_000;

describe('AC-08 scaffold-home journey', () => {
  if (nested) {
    it('is skipped inside a verify run (recursion guard)', () => {
      expect(nested).toBe(true);
    });
    return;
  }

  let server: ChildProcess | undefined;
  let releaseLock: (() => void) | undefined;

  beforeAll(async () => {
    releaseLock = await acquirePortLock();
    server = spawn('pnpm', ['dev'], {
      cwd: repoRoot,
      env: { ...process.env, [NESTED_ENV]: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    await waitForHttp(`${BASE_URL}/`, BOOT_MS);
  }, BOOT_MS + 30_000);

  afterAll(() => {
    if (server?.pid !== undefined) {
      try {
        process.kill(-server.pid, 'SIGKILL');
      } catch {
        server.kill('SIGKILL');
      }
    }
    releaseLock?.();
  });

  it('serves GET / on port 3210 with an app-title heading reading "Vextrus"', async () => {
    const page = await HomePage.open(BASE_URL);
    expect(page.status).toBe(200);

    const title = page.appTitle;
    expect(title, 'no element carries data-testid="app-title"').toBeDefined();
    expect(title?.text).toBe('Vextrus');
    // "minimal titled page: heading" — the testid must sit on a heading element
    expect(title?.tag).toMatch(/^h[1-6]$/);

    checkpoint('scaffold-home', `GET ${BASE_URL}/ → 200, app-title "${title?.text ?? ''}"`);
  }, 60_000);
});
