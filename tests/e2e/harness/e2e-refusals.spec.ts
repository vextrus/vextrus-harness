/**
 * The lane's refusals, driven as a caller types them.
 *
 * `pnpm e2e --journey J-999` is a named procedure of the test contract: exit 3,
 * saying `e2e: no journey J-999`. It is the guard that makes a mistyped
 * selection loud — without it, `--journey J-00O` runs the whole suite, goes
 * green, and reports that a journey nobody selected passed. That behaviour was
 * the only one of the lane's procedures with no test behind it.
 *
 * It runs in `pnpm test` (and so in `pnpm verify`) because it can: the refusal
 * happens before the build, the database and the browser (risk note 6), so this
 * costs a node start. The half of the lane that needs a database and chromium
 * stays in tests/e2e/e2e-lane.e2e.ts.
 *
 * This file sits beside the harness rather than in tests/acceptance/ because
 * tests/acceptance/ is the Verifier's; tests/e2e/harness/** is this increment's.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

/** tests/e2e/harness/ -> ../../.. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** `node scripts/e2e.mjs <args>`, run to completion, stdout and stderr together. */
function e2e(args: readonly string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'e2e.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('AC-03 an unknown journey is refused, loudly and cheaply', () => {
  test('`--journey J-999` exits 3 saying `e2e: no journey J-999`', () => {
    const result = e2e(['--journey', 'J-999']);

    expect(result.status, `expected exit 3, got ${String(result.status)}:\n${result.output}`).toBe(
      3,
    );
    expect(result.output, 'the refusal does not name the journey it could not find').toContain(
      'e2e: no journey J-999',
    );
  }, 60_000);

  test('it refuses before building or touching the database', () => {
    const result = e2e(['--journey', 'J-999']);

    expect(result.output, `the refusal built the app first:\n${result.output}`).not.toContain(
      'e2e: build',
    );
    expect(
      result.output,
      `the refusal touched the scratch database first:\n${result.output}`,
    ).not.toContain('vextrus_e2e_scratch');
  }, 60_000);

  test('`--journey` with its value forgotten is a different refusal, not a full run', () => {
    // The neighbouring mistake, and the one that would otherwise be silent: a
    // selection with no id must not degrade into "run everything". It exits 3
    // like an unknown id, but says what is missing rather than naming a journey.
    const result = e2e(['--journey']);

    expect(result.status, `expected exit 3, got ${String(result.status)}:\n${result.output}`).toBe(
      3,
    );
    expect(result.output, 'the refusal does not say a journey id is missing').toContain(
      '--journey needs a journey id',
    );
    expect(result.output, `an empty selection started the lane:\n${result.output}`).not.toContain(
      'e2e: build',
    );
  }, 60_000);
});
