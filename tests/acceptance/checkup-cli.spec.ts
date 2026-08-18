/**
 * Acceptance for `pnpm checkup` — V-CHECKUP: the machine's report (AC-02, AC-03).
 *
 * Failures are simulated through the CHECKUP_* env overrides only; the machine
 * is never mutated, so this is reproducible in CI (risk note 3).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { closedPort, listenOnEphemeralPort, runCli } from './support/cli';

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

const okLine = (fact: string): RegExp => new RegExp(`^ok\\s+${fact}\\b.*\\S`, 'm');
const failLine = (fact: string): RegExp => new RegExp(`^FAIL\\s+${fact}\\b.*\\S`, 'm');
const anyLine = (fact: string): RegExp => new RegExp(`^(ok|FAIL)\\s+${fact}\\b`, 'm');

const storageRoot = (): string => mkdtempSync(join(tmpdir(), 'vextrus-checkup-'));

describe('AC-02 — a healthy machine reports every fact and exits 0', () => {
  test('pnpm checkup names all eight facts with an ok marker and exits 0', async () => {
    // A live listener stands in for Postgres so the probe is deterministic in CI.
    const postgres = await listenOnEphemeralPort();
    try {
      const result = runCli('pnpm', ['checkup'], {
        CHECKUP_PG_PORT: String(postgres.port),
        CHECKUP_STORAGE_ROOT: storageRoot(),
      });

      for (const fact of FACTS) {
        expect(result.stdout, `fact ${fact} must be reported ok`).toMatch(okLine(fact));
      }
      expect(result.status).toBe(0);
    } finally {
      await postgres.close();
    }
  });

  test('each fact is one line carrying its name and a detail', async () => {
    const postgres = await listenOnEphemeralPort();
    try {
      const result = runCli('pnpm', ['checkup'], {
        CHECKUP_PG_PORT: String(postgres.port),
        CHECKUP_STORAGE_ROOT: storageRoot(),
      });
      const factLines = result.stdout
        .split('\n')
        .filter((line) => /^(ok|FAIL)\s/.test(line));

      expect(factLines.length).toBeGreaterThanOrEqual(FACTS.length);
      for (const line of factLines) {
        expect(line, 'format is `ok <fact-name> — detail`').toMatch(
          /^(ok|FAIL)\s+[a-z0-9-]+\s+—\s+\S+/,
        );
      }
    } finally {
      await postgres.close();
    }
  });
});

describe('AC-03 — checkup is not fail-fast', () => {
  test('an unreachable Postgres fails by name while every other fact still reports', async () => {
    const port = await closedPort();
    const result = runCli('pnpm', ['checkup'], {
      CHECKUP_PG_PORT: String(port),
      CHECKUP_STORAGE_ROOT: storageRoot(),
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(failLine('postgres-5544'));
    for (const fact of FACTS) {
      expect(result.stdout, `fact ${fact} must still be reported`).toMatch(anyLine(fact));
    }
  });

  test('an unwritable storage root fails by name and the run still reaches the env fact', async () => {
    const postgres = await listenOnEphemeralPort();
    try {
      const result = runCli('pnpm', ['checkup'], {
        CHECKUP_PG_PORT: String(postgres.port),
        CHECKUP_STORAGE_ROOT: join(storageRoot(), 'definitely', 'missing'),
      });

      expect(result.status).not.toBe(0);
      expect(result.stdout).toMatch(failLine('storage-root'));
      expect(result.stdout).toMatch(anyLine('env'));
      expect(result.stdout).toMatch(okLine('postgres-5544'));
    } finally {
      await postgres.close();
    }
  });
});
