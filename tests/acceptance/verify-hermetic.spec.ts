/**
 * Breaker acceptance: `pnpm verify` and `pnpm checkup` must be functions of the
 * tree and of the machine — never of a gitignored build artefact, and never
 * silently short of a fact.
 *
 * B-03: "no cache that can lie".  Q-01: verify's exit code is the contract.
 * V-CHECKUP: the machine's report — every fact, by name, in one pass.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

import { listenOnEphemeralPort, repoRoot, runCli } from './support/cli';

const DEV_TYPES_DIR = join(repoRoot(), '.next', 'dev', 'types');
const STALE_ARTEFACT = join(DEV_TYPES_DIR, '__breaker-stale.ts');

/** Runs verify's tsc stage alone — spawning `pnpm verify` here would recurse. */
const tscStage = () => runCli(process.execPath, [join('scripts', 'verify.d', '20-tsc.mjs')]);

afterAll(() => {
  rmSync(STALE_ARTEFACT, { force: true });
});

describe("B-03 — verify's typecheck reads the tree, not the dev server's artefacts", () => {
  test('a broken file under .next/dev/types cannot turn the tsc stage red', () => {
    expect(tscStage().status, 'the committed tree must typecheck before the injection').toBe(0);

    mkdirSync(DEV_TYPES_DIR, { recursive: true });
    // Exactly the shape Next leaves behind when a route is deleted after
    // `pnpm dev` has generated types for it: a dangling module reference.
    writeFileSync(
      STALE_ARTEFACT,
      "export type Stale = typeof import('../../../src/app/__deleted-route/page.js');\n",
      'utf8',
    );
    try {
      const result = tscStage();

      expect(
        result.status,
        'a stale, gitignored dev artefact must not decide whether verify passes',
      ).toBe(0);
    } finally {
      rmSync(STALE_ARTEFACT, { force: true });
    }
  }, 180_000);

  test('tsconfig does not hand the dev server distDir to the compiler', () => {
    const listed = runCli(
      join('node_modules', '.bin', 'tsc'),
      ['--noEmit', '--listFiles'],
    );
    const devFiles = listed.stdout
      .split('\n')
      .filter((line) => line.includes(`${join('.next', 'dev')}`));

    expect(devFiles, 'verify must not compile the dev server’s generated types').toEqual([]);
  }, 180_000);
});

describe('V-CHECKUP — a fact that cannot be probed still reports by name', () => {
  const FACTS = [
    'node-pin',
    'pnpm-pin',
    'uv-present',
    'postgres-5544',
    'port-3210',
    'port-3211',
    'storage-root',
    'env',
  ] as const;

  test('an unusable probe target fails the fact by name instead of crashing the report', async () => {
    // 99999 is outside the TCP range: the probe cannot be attempted at all.
    // "Cannot probe" is a failed fact, not a missing one.
    const result = runCli('pnpm', ['checkup'], { CHECKUP_PG_PORT: '99999' });

    expect(result.status, 'a fact that cannot be probed is a failure').not.toBe(0);
    expect(result.output).not.toMatch(/ERR_SOCKET_BAD_PORT/);
    for (const fact of FACTS) {
      expect(result.stdout, `fact ${fact} must still be reported by name`).toMatch(
        new RegExp(`^(ok|FAIL)\\s+${fact}\\b`, 'm'),
      );
    }
  }, 120_000);

  test('an empty override does not silently redirect the probe away from 5544', async () => {
    const listener = await listenOnEphemeralPort();
    try {
      // An unset-but-exported variable is the ordinary shell accident; it must
      // fall back to the contract port, not to port 0.
      const result = runCli('pnpm', ['checkup'], { CHECKUP_PG_PORT: '' });

      expect(result.stdout, 'the probe must address the contract port').toMatch(
        /^(ok|FAIL)\s+postgres-5544\s+—\s+.*:5544\b/m,
      );
    } finally {
      await listener.close();
    }
  }, 120_000);
});
