/**
 * AC-15: a reasoned baseline update rewrites only the journey it was asked for,
 * and records why — the other journeys' committed baselines are untouched.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { ensureBrowsers, lane, repoRoot } from './support';

const baselines = (journeyId: string): string =>
  join(repoRoot(), 'tests', 'e2e', 'baselines', journeyId);

const UPDATES = (): string => join(repoRoot(), 'tests', 'e2e', 'baselines', 'UPDATES.md');

interface Snapshot {
  readonly bytes: string;
  readonly mtimeMs: number;
}

/** Every file of a baseline directory, by content and mtime. */
function snapshot(dir: string): Record<string, Snapshot> {
  const out: Record<string, Snapshot> = {};
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(dir, entry.name);
    out[entry.name] = {
      bytes: readFileSync(file).toString('base64'),
      mtimeMs: statSync(file).mtimeMs,
    };
  }
  return out;
}

const REASON = 'resize header';

let updatesBefore = '';

describe('AC-15 `pnpm e2e --update-baselines --reason "..." --journey J-SELF`', () => {
  beforeAll(() => {
    ensureBrowsers();
    updatesBefore = existsSync(UPDATES()) ? readFileSync(UPDATES(), 'utf8') : '';
  });

  afterAll(() => {
    // The log is an append-only record of real updates; this run was a test.
    if (updatesBefore !== '') writeFileSync(UPDATES(), updatesBefore);
  });

  test('rewrites J-SELF only, records the reason, and exits 0', () => {
    const before000 = snapshot(baselines('J-000'));
    expect(
      Object.keys(before000),
      'no committed J-000 baseline to leave alone',
    ).not.toHaveLength(0);

    const result = lane(['--update-baselines', '--reason', REASON, '--journey', 'J-SELF']);
    expect(result.status, `the reasoned update run failed:\n${result.output}`).toBe(0);

    expect(
      snapshot(baselines('J-000')),
      'updating J-SELF rewrote the J-000 baselines',
    ).toStrictEqual(before000);

    const after = readFileSync(UPDATES(), 'utf8');
    const withReason = (text: string): string[] =>
      text.split('\n').filter((line) => line.includes(REASON));
    const appended = withReason(after);
    expect(
      appended.length,
      `no line recording the reason was appended to UPDATES.md:\n${after}`,
    ).toBeGreaterThan(withReason(updatesBefore).length);

    const dates = [Date.now(), Date.now() - 86_400_000, Date.now() + 86_400_000].map((ms) =>
      new Date(ms).toISOString().slice(0, 10),
    );
    expect(
      appended.some((line) => dates.some((date) => line.includes(date))),
      `the recorded line carries no ISO date:\n${appended.join('\n')}`,
    ).toBe(true);

    // The journey it was asked to update still has a baseline to compare against.
    expect(
      Object.keys(snapshot(baselines('J-SELF'))).filter((name) => name.endsWith('.png')),
      'the J-SELF baseline is gone after its own update run',
    ).not.toHaveLength(0);
  });
});
