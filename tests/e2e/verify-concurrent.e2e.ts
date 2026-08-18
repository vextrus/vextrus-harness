/**
 * Breaker: V-VERIFY reports on the tree, it does not edit it — `verify.d` guards
 * that with `withTsconfigPreserved` (scripts/lib/stage.mjs), which snapshots
 * `tsconfig.json` before `next typegen` / `next build` append their distDir
 * globs and writes the snapshot back afterwards. `90-build.mjs` states the
 * stronger property in its own comment: "two runs against one worktree must not
 * destroy each other".
 *
 * They do. The snapshot is read at stage entry with no lock, so a second run
 * that enters the build stage while the first has already mutated the file
 * snapshots the *mutated* text and restores that. `tsconfig.json` is left
 * permanently carrying a `.next-verify/build-<pid>` include for a directory that
 * has since been deleted — and both runs exit 0 without a word about it.
 *
 * Only the two Next stages touch `tsconfig.json`, so the race is isolated with
 * `VERIFY_ONLY=90-build`: that keeps the test honest about what it is proving
 * and independent of whether the other four stages happen to be green.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot, waitFor } from '../acceptance/support/cli';

const TSCONFIG = join(repoRoot(), 'tsconfig.json');
const before = readFileSync(TSCONFIG, 'utf8');

/** The per-process build glob `next build` appends; the residue to look for. */
const PER_PROCESS_GLOB = /build-\d+/;

// The point of this test is the tree, so the tree is put back whatever happens.
afterAll(() => {
  if (readFileSync(TSCONFIG, 'utf8') !== before) writeFileSync(TSCONFIG, before, 'utf8');
});

interface Run {
  readonly status: number;
  readonly output: string;
}

function buildStage(): Promise<Run> {
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(process.execPath, [join(repoRoot(), 'scripts', 'verify.mjs')], {
      cwd: repoRoot(),
      env: { ...process.env, VERIFY_ONLY: '90-build' },
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (status) => resolve({ status: status ?? 1, output }));
  });
}

describe('two `pnpm verify` runs against one worktree', () => {
  it('leaves tsconfig.json exactly as it found it', async () => {
    expect(readFileSync(TSCONFIG, 'utf8')).toBe(before);

    const first = buildStage();

    // The interleaving that matters, hit deliberately rather than by timing
    // luck: the second run starts only once the first has demonstrably rewritten
    // `tsconfig.json`, which is precisely the window `withTsconfigPreserved`
    // snapshots the wrong text in.
    const mutated = await waitFor(
      () => Promise.resolve(PER_PROCESS_GLOB.test(readFileSync(TSCONFIG, 'utf8'))),
      120_000,
      50,
    );
    expect(mutated, 'the first run never rewrote tsconfig.json — race not exercised').toBe(true);

    const second = buildStage();
    const [a, b] = await Promise.all([first, second]);

    const after = readFileSync(TSCONFIG, 'utf8');

    // Neither run may leave a footprint on the tree, whatever its exit code.
    expect(after).not.toMatch(PER_PROCESS_GLOB);
    expect(after, `verify mutated tsconfig.json:\n${after}`).toBe(before);

    // And the silence is the aggravating factor: both runs report success.
    expect([a.status, b.status]).toEqual([0, 0]);
  }, 300_000);
});
