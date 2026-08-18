/**
 * Breaker journey segments: `pnpm verify` must be green on a clean tree whatever
 * else the developer happens to be running.
 *
 * Named `*.e2e.ts` because they shell out to `pnpm verify`; running them inside
 * verify's own vitest stage would recurse. Run with:
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { createServer } from 'node:net';
import { describe, expect, test } from 'vitest';

import { type CliResult, runCli } from '../acceptance/support/cli';

const verify = (): CliResult => runCli('pnpm', ['verify'], {}, 300_000);

/** Holds a port the way `pnpm dev` holds 3210 while a second terminal verifies. */
async function hold(port: number): Promise<() => Promise<void>> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
}

const after = (ms: number): Promise<CliResult> =>
  new Promise<CliResult>((resolve) => {
    setTimeout(() => resolve(verify()), ms);
  });

describe('Q-01 — verify is a function of the tree, not of the running processes', () => {
  test('pnpm verify is green while the dev server holds port 3210', async () => {
    const release = await hold(3210);
    try {
      const result = verify();

      expect(
        result.status,
        `dev on 3210 and verify in a second terminal is the ordinary workflow:\n${result.output}`,
      ).toBe(0);
    } finally {
      await release();
    }
  }, 300_000);
});

describe('B-03 — two verify runs on one checkout do not corrupt each other', () => {
  test('a second pnpm verify started mid-build does not make the first one lie', async () => {
    const [first, second] = await Promise.all([after(0), after(3_000)]);

    // Whatever serialisation the runner chooses, neither run may report a
    // failure the tree did not cause.
    expect(first.status, `first run:\n${first.output}`).toBe(0);
    expect(second.status, `second run:\n${second.output}`).toBe(0);
  }, 600_000);
});
