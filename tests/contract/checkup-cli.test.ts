/**
 * V-CHECKUP as a contract: the machine's report, every fact named, never
 * fail-fast.
 *
 * Proves: V-CHECKUP, B-10 (a claim of progress is audited against a tool
 * result), AC-02, AC-03.
 *
 * Health is simulated through the documented CHECKUP_* overrides only — the
 * machine is never mutated, so this suite is reproducible in CI (risk note 3).
 * The Postgres probe is pointed at a socket this test opens itself, so "healthy"
 * does not mean "a Postgres happens to be running here"; the default port 5544
 * is pinned separately below.
 */
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { CHECKUP_FACTS, factLine, runCheckup } from './support/cli';

const TIMEOUT = 120_000;

let listener: net.Server | undefined;

/** Opens a listening TCP socket and returns its port (a stand-in Postgres). */
async function openPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  listener = server;
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');
  return address.port;
}

afterEach(async () => {
  const server = listener;
  listener = undefined;
  if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('pnpm checkup', () => {
  // V-CHECKUP · AC-02: a healthy machine reports every fact, ok, exit 0.
  it('AC-02: exits 0 and names all eight facts with ok markers', { timeout: TIMEOUT }, async () => {
    const port = await openPort();
    const result = runCheckup({ CHECKUP_PG_PORT: String(port) });
    for (const fact of CHECKUP_FACTS) {
      const line = factLine(result.output, fact);
      expect(line, `missing report line for fact ${fact}`).toBeDefined();
      expect(line, `fact ${fact} did not report ok`).toMatch(new RegExp(`^ok\\s+${fact}\\b`));
      // Interfaces: `ok <fact-name> — detail` — the detail is what makes the
      // report a report rather than a boolean.
      expect((line ?? '').replace(new RegExp(`^ok\\s+${fact}`), '').trim().length).toBeGreaterThan(
        0,
      );
    }
    expect(result.status).toBe(0);
  });

  // V-CHECKUP · AC-02: the Bible's dev Postgres lives on 5544; the default the
  // probe reads is part of the contract, whether or not it answers here.
  it('AC-02: probes port 5544 by default', { timeout: TIMEOUT }, () => {
    const result = runCheckup();
    const line = factLine(result.output, 'postgres-5544');
    expect(line).toBeDefined();
    expect(line).toMatch(/5544/);
  });

  // V-CHECKUP · AC-03: one failing fact must not hide the others.
  it(
    'AC-03: an unreachable Postgres fails postgres-5544 by name and still reports the rest',
    { timeout: TIMEOUT },
    () => {
      // Port 1 is never listening; simulated by env, the machine is untouched.
      const result = runCheckup({ CHECKUP_PG_PORT: '1' });
      expect(result.status).not.toBe(0);
      expect(factLine(result.output, 'postgres-5544')).toMatch(/^FAIL\s+postgres-5544\b/);
      for (const fact of CHECKUP_FACTS) {
        expect(factLine(result.output, fact), `fact ${fact} went unreported`).toBeDefined();
      }
    },
  );

  // V-CHECKUP · AC-03: the storage-root fact fails independently, same way.
  it(
    'AC-03: an unwritable storage root fails storage-root by name and still reports the rest',
    { timeout: TIMEOUT },
    async () => {
      const port = await openPort();
      const result = runCheckup({
        CHECKUP_PG_PORT: String(port),
        CHECKUP_STORAGE_ROOT: '/proc/vextrus-storage-root-does-not-exist',
      });
      expect(result.status).not.toBe(0);
      expect(factLine(result.output, 'storage-root')).toMatch(/^FAIL\s+storage-root\b/);
      for (const fact of CHECKUP_FACTS) {
        expect(factLine(result.output, fact), `fact ${fact} went unreported`).toBeDefined();
      }
      // Not fail-fast: the facts after the failure still reported ok.
      expect(factLine(result.output, 'env')).toMatch(/^ok\s+env\b/);
    },
  );
});
