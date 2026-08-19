/**
 * V-CHECKUP / AC-01: `pnpm verify`'s exit code is the whole contract, so the
 * suite it runs must judge the tree, not the machine's spare capacity.
 *
 * The port facts are right to fail when 3210/3211 are in use — an in-use port is
 * not a bindable port, and reporting `ok` there would make the fact
 * unfalsifiable. That is exactly why each fact takes a per-fact override
 * (`CHECKUP_PORT_3210`, `CHECKUP_PORT_3211`): a suite can probe a port of its
 * choosing while the fact keeps its contract name.
 *
 * The AC-02 acceptance does not use them, so it asserts `ok port-3210` against
 * the real 3210 — and 3210 is precisely the port `pnpm dev` holds. The two
 * journey checkpoints then exclude each other: with the app running on 3210
 * (checkpoint `scaffold-home`), `pnpm test` fails and `pnpm verify` goes red on
 * a tree with nothing wrong with it. Two concurrent verify runs collide the same
 * way, each binding 3210/3211 out from under the other.
 *
 * This holds both contract ports and re-runs the checkup acceptance underneath.
 */
import { describe, expect, test } from 'vitest';

import { listenOnEphemeralPort, runCli } from './support/cli';

/** Holds a specific port, the way `pnpm dev` holds 3210. */
async function hold(port: number): Promise<{ close: () => Promise<void> }> {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('the checkup acceptance judges the tree, not the machine`s free ports', () => {
  test('it still passes while `pnpm dev` holds 3210 and something holds 3211', async () => {
    const held = [await hold(3210), await hold(3211)];
    try {
      const result = runCli(
        'pnpm',
        ['exec', 'vitest', 'run', '--no-cache', 'tests/acceptance/checkup-cli.spec.ts'],
        {},
        180_000,
      );

      expect(
        result.status,
        'the checkup acceptance must not depend on the real 3210/3211 being free — ' +
          'it has CHECKUP_PORT_3210 / CHECKUP_PORT_3211 for exactly this\n' +
          result.output,
      ).toBe(0);
    } finally {
      for (const server of held) await server.close();
    }
  }, 200_000);

  test('the fact itself still tells the truth: an in-use port is not bindable', async () => {
    const held = await hold(3210);
    try {
      const result = runCli('pnpm', ['checkup'], {});
      expect(result.stdout, 'a held port must be reported FAIL, never ok').toMatch(
        /^FAIL\s+port-3210\b/m,
      );
    } finally {
      await held.close();
    }
  }, 120_000);

  test('the override lets a suite probe a free port while the fact keeps its name', async () => {
    const held = await hold(3210);
    const spare = await listenOnEphemeralPort();
    const sparePort = spare.port;
    await spare.close();
    try {
      const result = runCli('pnpm', ['checkup'], { CHECKUP_PORT_3210: String(sparePort) });
      expect(result.stdout).toMatch(/^ok\s+port-3210\b/m);
      expect(result.stdout, 'the detail names the port it really probed').toMatch(
        new RegExp(`^ok\\s+port-3210\\b.*${sparePort}`, 'm'),
      );
    } finally {
      await held.close();
    }
  }, 120_000);
});
