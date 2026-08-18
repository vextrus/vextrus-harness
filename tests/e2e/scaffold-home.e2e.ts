/**
 * Journey checkpoint `scaffold-home` (AC-08).
 *
 * Named `*.e2e.ts` on purpose: the default vitest include only matches
 * `*.test.*`/`*.spec.*`, so the verify run's own vitest stage never re-enters
 * these journeys. Run with:
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { afterAll, beforeAll, expect, test } from 'vitest';

import { elementByTestId, startDevServer, visibleText, type DevServer } from './support/dev-server';

let server: DevServer;

beforeAll(async () => {
  server = await startDevServer(3210);
}, 200_000);

afterAll(async () => {
  await server?.stop();
});

// AC-08: GET / on the dev server (port 3210) serves the titled root page.
test('checkpoint scaffold-home — / serves the app-title heading "Vextrus"', async () => {
  const response = await fetch(`${server.baseUrl}/`);
  expect(response.status).toBe(200);

  const html = await response.text();
  const title = elementByTestId(html, 'app-title');

  expect(title, 'an element must carry data-testid="app-title"').toBeDefined();
  expect(visibleText(title ?? '')).toBe('Vextrus');
}, 60_000);

// AC-08: the testid is the heading, not a wrapper — later increments key off it.
test('checkpoint scaffold-home — app-title is a heading element', async () => {
  const html = await (await fetch(`${server.baseUrl}/`)).text();
  const headingWithTestId = /<h[1-6][^>]*\bdata-testid="app-title"[^>]*>/.exec(html);

  expect(headingWithTestId, 'data-testid="app-title" belongs on the h1').not.toBeNull();
}, 60_000);
