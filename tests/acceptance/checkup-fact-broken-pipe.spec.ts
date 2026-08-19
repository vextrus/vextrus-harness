/**
 * V-CHECKUP — a closed pipe ends a report, it does not crash it.
 *
 * `scripts/checkup.mjs` and `scripts/verify.mjs` both install a broken-pipe
 * guard, and `scripts/lib/report.mjs` documents why: its stdout is a pipe
 * whenever a caller captures the report. But the facts are separate processes
 * that call `report()` themselves, and reading one on its own — `node
 * scripts/checkup.d/40-ports-env.mjs | head -1`, the obvious way to look at a
 * single fact while debugging a machine — closes that pipe on the fact, not on
 * the runner.
 *
 * A fact that answers a closed pipe with an unhandled `EPIPE` stack trace is a
 * machine report replaced by a crash: the reader who walked away is told the
 * probe is broken, when the probe was fine.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { closedPort, repoRoot } from './support/cli';

const factsDir = join(repoRoot(), 'scripts', 'checkup.d');
const facts = readdirSync(factsDir)
  .filter((entry) => entry.endsWith('.mjs'))
  .sort();

describe('a checkup fact survives a reader that walks away', () => {
  it('there is at least one fact to read', () => {
    expect(facts.length).toBeGreaterThan(0);
  });

  it.each(facts)('%s piped into `head -1` does not crash', async (fact) => {
    // The probes point at ports that were bindable a moment ago and are now
    // closed, so this test never touches 3210/3211 or a real database.
    const [a, b, c] = [await closedPort(), await closedPort(), await closedPort()];
    const result = spawnSync(
      '/bin/sh',
      ['-c', `node ${JSON.stringify(join('scripts', 'checkup.d', fact))} | head -1`],
      {
        cwd: repoRoot(),
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          CHECKUP_PG_PORT: String(a),
          CHECKUP_PORT_3210: String(b),
          CHECKUP_PORT_3211: String(c),
        },
      },
    );

    expect(
      result.stderr ?? '',
      'a closed pipe is the reader’s decision, not a fault in the probe',
    ).not.toMatch(/EPIPE|Unhandled 'error' event/);
  });
});
