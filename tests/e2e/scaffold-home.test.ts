import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HomePage } from './support/home.page';
import { isNestedRun } from './support/proc';
import { DEV_URL, startDevServer, type DevServer } from './support/server';

/** Journey checkpoint: scaffold-home — `/` served by pnpm dev on port 3210. */
describe.runIf(!isNestedRun())('checkpoint: scaffold-home', () => {
  let server: DevServer;
  const home = new HomePage(DEV_URL);
  let status = 0;

  beforeAll(async () => {
    server = await startDevServer();
    status = await home.open();
  }, 300_000);

  afterAll(() => server?.stop());

  // AC-08: GET / on port 3210 answers.
  it('serves / on port 3210', () => {
    expect(status).toBe(200);
  });

  // AC-08: the title element carries data-testid="app-title" and reads "Vextrus".
  it('renders the app-title heading reading "Vextrus"', () => {
    expect(home.titleText()).toBe('Vextrus');
    expect(home.titleTag()).toMatch(/^h[1-6]$/);
  });
});
