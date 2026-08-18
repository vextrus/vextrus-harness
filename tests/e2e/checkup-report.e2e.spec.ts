/**
 * Journey checkpoint `checkup-report` — AC-02 and AC-03.
 *
 * V-CHECKUP: the machine's report. Unlike verify it is NOT fail-fast: a broken
 * fact must not hide the ones behind it.
 */
import { describe, expect, it } from 'vitest';

import { factLine, runScript } from './helpers/proc';

/** The eight facts this leaf owns (interfaces: fact names). */
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

describe('journey: checkup-report', () => {
  // AC-02: healthy machine — exit 0 and every fact named with an ok marker.
  it('pnpm checkup exits 0 and reports all eight facts as ok', () => {
    const run = runScript('checkup');

    for (const fact of FACTS) {
      const line = factLine(run.output, fact);
      expect(line, `fact "${fact}" was not reported by name`).toBeDefined();
      expect(line, `fact "${fact}" was not ok`).toMatch(new RegExp(`^ok\\s+${fact}\\b`));
      // Each line carries a detail after the fact name.
      expect(line?.length ?? 0).toBeGreaterThan(`ok ${fact}`.length);
    }

    expect(run.code, run.output).toBe(0);
  });

  // AC-03: one fact fails, by env override only — the machine is never touched.
  it('exits non-zero on a failed fact while still reporting every other fact', () => {
    // Port 1 is never listening; the probe must report a refused connection.
    const run = runScript('checkup', { CHECKUP_PG_PORT: '1' });

    expect(run.code, run.output).not.toBe(0);

    const postgres = factLine(run.output, 'postgres-\\d+');
    expect(postgres, 'the postgres fact was not reported by name').toBeDefined();
    expect(postgres).toMatch(/^FAIL\s+postgres-\d+\b/);

    // Not fail-fast: everything else is still reported.
    for (const fact of FACTS.filter((f) => !f.startsWith('postgres'))) {
      const line = factLine(run.output, fact);
      expect(line, `fact "${fact}" was suppressed by the earlier failure`).toBeDefined();
      expect(line, `fact "${fact}" should still be ok`).toMatch(new RegExp(`^ok\\s+${fact}\\b`));
    }
  });
});
