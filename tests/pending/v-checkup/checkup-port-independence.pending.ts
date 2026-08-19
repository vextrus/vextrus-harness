/**
 * V-CHECKUP / AC-01: `pnpm verify`'s exit code is the whole contract, so the
 * suite it runs must judge the tree, not the machine's spare capacity.
 *
 * The AC-02 acceptance asserts `ok port-3210` — and 3210 is precisely the port
 * `pnpm dev` holds. The two journey checkpoints then exclude each other: with
 * the app running on 3210 (checkpoint `scaffold-home`), `pnpm test` fails and
 * `pnpm verify` goes red on a tree with nothing wrong with it. Two concurrent
 * verify runs collide the same way, each binding 3210/3211 out from under the
 * other.
 *
 * This holds both contract ports and re-runs the checkup acceptance underneath.
 * What it asserts is the behaviour — the checkup acceptance passes while the
 * contract ports are in use — and not any particular way of getting there: a
 * per-fact port override, an ephemeral port, or no listener at all are all the
 * checkup leaf's to choose.
 *
 * Relocated out of `tests/acceptance/` by arbitration on m0-02-db-lane together
 * with `checkup-cli.pending.ts`, which it runs; see the README beside it. The
 * path below is that file's home when the checkup leaf restores the pair.
 */
import { describe, expect, test } from 'vitest';

import { runCli } from '../../acceptance/support/cli';

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
        'the checkup acceptance must not depend on the real 3210/3211 being free\n' +
          result.output,
      ).toBe(0);
    } finally {
      for (const server of held) await server.close();
    }
  }, 200_000);
});
