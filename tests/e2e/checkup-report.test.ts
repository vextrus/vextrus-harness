import { describe, expect, it } from 'vitest';

import { isNestedRun, pnpm, type Run } from './support/proc';

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

/** Parses the one-line-per-fact report: `ok <fact> — detail` / `FAIL <fact> — detail`. */
function report(result: Run): Map<string, 'ok' | 'FAIL'> {
  const facts = new Map<string, 'ok' | 'FAIL'>();
  for (const line of result.out.split('\n')) {
    const match = /^\s*(ok|FAIL)\s+([a-z0-9-]+)\s*(?:[—–-]{1,2})\s*\S/.exec(line);
    if (match?.[1] && match[2]) facts.set(match[2], match[1] as 'ok' | 'FAIL');
  }
  return facts;
}

/** Journey checkpoint: checkup-report — every machine fact, named, on its own line. */
describe.runIf(!isNestedRun())('checkpoint: checkup-report', () => {
  // AC-02 / V-CHECKUP: healthy machine — all eight facts ok, exit 0.
  it('names every fact with an ok marker and exits 0', async () => {
    const result = await pnpm('checkup');
    const facts = report(result);

    for (const fact of FACTS) {
      expect(facts.get(fact), `fact not reported: ${fact}\n${result.out}`).toBe('ok');
    }
    expect(result.code, result.out).toBe(0);
  }, 180_000);

  // AC-03 / V-CHECKUP: checkup is not fail-fast — one bad fact, full report.
  it('reports every remaining fact and exits non-zero when Postgres is unreachable', async () => {
    const result = await pnpm('checkup', { CHECKUP_PG_PORT: '1' });
    const facts = report(result);

    expect(facts.get('postgres-5544')).toBe('FAIL');
    expect(result.code).not.toBe(0);
    for (const fact of FACTS) {
      expect(facts.has(fact), `fact dropped after a failure: ${fact}\n${result.out}`).toBe(true);
    }
    const others = FACTS.filter((f) => f !== 'postgres-5544');
    expect(others.map((f) => facts.get(f))).toEqual(others.map(() => 'ok'));
  }, 180_000);
});
