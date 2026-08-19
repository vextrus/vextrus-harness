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
 * This re-runs the checkup acceptance underneath, with the port facts pointed at
 * ports it mints and holds itself.
 *
 * It does not hold 3210 or 3211 to do it. Simulating `pnpm dev` by binding the
 * very port `pnpm dev` binds reintroduces the mutual exclusion this file exists
 * to abolish: a held port cannot be held twice, so on a machine where the app is
 * already running — or where a second verify run is in flight — the bind throws
 * EADDRINUSE and a tree with nothing wrong with it goes red. The per-fact
 * `CHECKUP_PORT_3210` / `CHECKUP_PORT_3211` overrides exist for exactly this: an
 * ephemeral port this file holds is as unbindable as 3210 is, and the fact keeps
 * its contract name either way. `verify-port-independence.spec.ts` is that rule
 * made mechanical.
 */
import { describe, expect, test } from 'vitest';

import { listenOnEphemeralPort, runCli } from './support/cli';

/** Holds a port nobody else claims, the way `pnpm dev` holds 3210. */
async function holdEphemeral(): Promise<{ port: number; close: () => Promise<void> }> {
  const { createServer } = await import('node:net');
  const server = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('the held server reported no port'));
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

describe('the checkup acceptance judges the tree, not the machine`s free ports', () => {
  test('it still passes while the ports its facts probe are held', async () => {
    const held = [await holdEphemeral(), await holdEphemeral()];
    try {
      const result = runCli(
        'pnpm',
        ['exec', 'vitest', 'run', '--no-cache', 'tests/acceptance/checkup-cli.spec.ts'],
        {
          CHECKUP_PORT_3210: String(held[0]?.port ?? 0),
          CHECKUP_PORT_3211: String(held[1]?.port ?? 0),
        },
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
    const held = await holdEphemeral();
    try {
      const result = runCli('pnpm', ['checkup'], { CHECKUP_PORT_3210: String(held.port) });
      expect(result.stdout, 'a held port must be reported FAIL, never ok').toMatch(
        /^FAIL\s+port-3210\b/m,
      );
    } finally {
      await held.close();
    }
  }, 120_000);

  test('the override lets a suite probe a free port while the fact keeps its name', async () => {
    const spare = await listenOnEphemeralPort();
    const sparePort = spare.port;
    await spare.close();

    const result = runCli('pnpm', ['checkup'], { CHECKUP_PORT_3210: String(sparePort) });
    expect(result.stdout).toMatch(/^ok\s+port-3210\b/m);
    expect(result.stdout, 'the detail names the port it really probed').toMatch(
      new RegExp(`^ok\\s+port-3210\\b.*${sparePort}`, 'm'),
    );
  }, 120_000);
});
