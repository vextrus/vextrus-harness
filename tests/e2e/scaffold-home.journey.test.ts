/**
 * Journey segment `scaffold-home`: the app builds, serves, and says its name.
 *
 * Proves: AC-08 and B-10 (progress audited against a tool result — a real HTTP
 * response from the real dev server, not a rendered component in isolation).
 *
 * Checkpoints: dev-server-up → home-served → app-title-present.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { HomePage } from './pages/home-page';
import { DEV_ORIGIN, DEV_PORT, startDevServer, type DevServer } from './support/dev-server';

const TIMEOUT = 180_000;

let booting: Promise<DevServer> | undefined;

/**
 * Checkpoint: dev-server-up — `pnpm dev` answers on 3210 (Bible <dev>). Booted
 * lazily and shared, so a server that never comes up fails each checkpoint with
 * its own reason instead of silently skipping them.
 */
function devServer(): Promise<DevServer> {
  booting ??= startDevServer(TIMEOUT);
  return booting;
}

afterAll(async () => {
  if (booting !== undefined) {
    const server = await booting.catch(() => undefined);
    await server?.stop();
  }
});

describe('scaffold-home', () => {
  // AC-08: GET / on the dev server returns a page, 200.
  it('AC-08: checkpoint home-served — GET / on port 3210 returns 200 HTML', { timeout: TIMEOUT }, async () => {
    await devServer();
    expect(DEV_PORT).toBe(3210);
    const response = await fetch(`${DEV_ORIGIN}/`, { redirect: 'follow' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
  });

  // AC-08: the title element carries the testid and the visible name.
  it('AC-08: checkpoint app-title-present — data-testid="app-title" reads "Vextrus"', { timeout: TIMEOUT }, async () => {
    await devServer();
    const home = await new HomePage().open();
    expect(home.appTitleElement(), 'no element with data-testid="app-title"').toBeDefined();
    expect(home.appTitleText()).toBe('Vextrus');
  });

  // Screens: a heading, and the document is titled.
  it('AC-08: the title element is a heading and the document has a title', { timeout: TIMEOUT }, async () => {
    await devServer();
    const home = await new HomePage().open();
    expect(home.appTitleElement()).toMatch(/^<h1\b/i);
    expect(home.document()).toMatch(/<title>[\s\S]*Vextrus[\s\S]*<\/title>/i);
  });
});
