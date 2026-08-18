/**
 * V-VERIFY: "the exit code is the whole contract" — so the exit code must be a
 * statement about the tree, not about what else happens to be running on the
 * machine.
 *
 * Two regressions live here:
 *  - `pnpm verify` goes red whenever the app's own dev server holds port 3210,
 *    because the checkup acceptance asserts `ok port-3210` against the real
 *    machine with no override for the port facts;
 *  - two `pnpm verify` runs against one worktree destroy each other, because the
 *    build stage deletes `.next-verify` out from under the other run.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { describe, expect, test } from 'vitest';

import { repoRoot } from './support/cli';

const hold = (port: number): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });

const release = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));

describe('V-VERIFY — the exit code describes the tree, not the machine', () => {
  test(
    'the suite stays green while the dev server holds ports 3210 and 3211',
    async () => {
      const servers = [await hold(3210), await hold(3211)];
      try {
        const run = spawnSync(
          'pnpm',
          ['exec', 'vitest', 'run', '--no-cache', 'tests/acceptance/checkup-cli.spec.ts'],
          { cwd: repoRoot(), encoding: 'utf8', env: process.env, timeout: 240_000 },
        );

        expect(
          run.status,
          `verify's vitest stage must not depend on port 3210 being free:\n${run.stdout}\n${run.stderr}`,
        ).toBe(0);
      } finally {
        for (const server of servers) await release(server);
      }
    },
    300_000,
  );

  test(
    'two verify runs against one worktree do not destroy each other',
    async () => {
      // `spawn`, not `spawnSync`: the two runs have to genuinely overlap.
      const build = (): Promise<{ status: number; output: string }> =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, ['scripts/verify.mjs'], {
            cwd: repoRoot(),
            env: { ...process.env, VERIFY_ONLY: 'build' },
          });
          let output = '';
          child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
          child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
          child.on('close', (code) => resolve({ status: code ?? 1, output }));
        });

      const first = build();
      const second = new Promise<{ status: number; output: string }>((resolve) => {
        setTimeout(() => void build().then(resolve), 1_200);
      });
      const [a, b] = await Promise.all([first, second]);

      expect(a.status, `first concurrent verify failed:\n${a.output}`).toBe(0);
      expect(b.status, `second concurrent verify failed:\n${b.output}`).toBe(0);
    },
    300_000,
  );
});
