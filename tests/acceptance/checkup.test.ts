// V-CHECKUP — the machine's report. Every fact named, never fail-fast.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pnpm } from '../support/run';
import { closedPort, closeServer, listenOn } from '../support/net';
import { withPortLock } from '../support/port-lock';

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

const CHECKUP_TIMEOUT_MS = 120_000;

/** `ok <fact> — detail` / `FAIL <fact> — detail`, one fact per line. */
const factLine = (output: string, fact: string): string | undefined =>
  output.split('\n').find((line) => new RegExp(`^\\s*(ok|FAIL)\\s+${fact}(\\s|$)`).test(line));

let storageRoot = '';
let fakePostgres: Server | undefined;
let fakePostgresPort = 0;

beforeAll(async () => {
  storageRoot = mkdtempSync(join(tmpdir(), 'vextrus-storage-'));
  fakePostgres = await listenOn(0);
  const address = fakePostgres.address();
  fakePostgresPort = typeof address === 'object' && address !== null ? address.port : 0;
});

afterAll(async () => {
  if (fakePostgres !== undefined) {
    await closeServer(fakePostgres);
  }
  rmSync(storageRoot, { recursive: true, force: true });
});

describe.sequential('pnpm checkup', () => {
  it('reports all eight named facts and exits 0 on a healthy machine', async () => {
    // AC-02 / V-CHECKUP — checkpoint `checkup-report`.
    const result = await withPortLock(async () =>
      pnpm(
        ['checkup'],
        { CHECKUP_PG_PORT: String(fakePostgresPort), CHECKUP_STORAGE_ROOT: storageRoot },
        CHECKUP_TIMEOUT_MS,
      ),
    );

    for (const fact of FACTS) {
      const line = factLine(result.output, fact);
      expect(line, `fact "${fact}" was not reported:\n${result.output}`).toBeDefined();
      expect(line ?? '', `fact "${fact}" needs a marker and a detail`).toMatch(
        new RegExp(`^\\s*(ok|FAIL)\\s+${fact}\\s+—\\s+\\S`),
      );
    }
    expect(result.code, `checkup failed:\n${result.output}`).toBe(0);
  }, CHECKUP_TIMEOUT_MS);

  it('exits non-zero on an unreachable Postgres yet still reports every other fact', async () => {
    // AC-03 / V-CHECKUP — not fail-fast; failure simulated by env override only.
    const deadPort = await closedPort();
    const result = await withPortLock(async () =>
      pnpm(
        ['checkup'],
        { CHECKUP_PG_PORT: String(deadPort), CHECKUP_STORAGE_ROOT: storageRoot },
        CHECKUP_TIMEOUT_MS,
      ),
    );

    expect(result.code, `expected a non-zero exit:\n${result.output}`).not.toBe(0);
    expect(factLine(result.output, 'postgres-5544') ?? '').toMatch(/^\s*FAIL\s+postgres-5544\s/);

    for (const fact of FACTS.filter((name) => name !== 'postgres-5544')) {
      expect(
        factLine(result.output, fact),
        `checkup stopped early — "${fact}" was not reported:\n${result.output}`,
      ).toBeDefined();
    }
  }, CHECKUP_TIMEOUT_MS);

  it('marks the storage root failed by name when the root is missing', async () => {
    // AC-03 — a second, independent fact proves the report is per-fact.
    const missing = join(tmpdir(), `vextrus-storage-absent-${String(process.pid)}`);
    const result = await withPortLock(async () =>
      pnpm(
        ['checkup'],
        { CHECKUP_PG_PORT: String(fakePostgresPort), CHECKUP_STORAGE_ROOT: missing },
        CHECKUP_TIMEOUT_MS,
      ),
    );

    expect(result.code).not.toBe(0);
    expect(factLine(result.output, 'storage-root') ?? '').toMatch(/^\s*FAIL\s+storage-root\s/);
    expect(factLine(result.output, 'env')).toBeDefined();
  }, CHECKUP_TIMEOUT_MS);
});
