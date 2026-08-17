import { describe, expect, it } from 'vitest';
import {
  CHECKUP_FACTS,
  checkupFactFailed,
  checkupFactLine,
  checkupFactOk,
  closedPort,
  openListener,
  pnpm,
} from './harness';

describe('journey: checkup-report (V-CHECKUP)', () => {
  it('[checkpoint: checkup-report] AC-02 — every fact is reported on its own marked line', () => {
    const result = pnpm(['checkup'], { timeoutMs: 120_000 });
    for (const fact of CHECKUP_FACTS) {
      const line = checkupFactLine(result.output, fact);
      expect(line, `fact "${fact}" missing from:\n${result.output}`).toBeDefined();
      // V-CHECKUP report format: "ok <fact-name> — detail" / "FAIL <fact-name> — detail".
      expect(line).toMatch(new RegExp(`^(ok|FAIL)\\s+${fact}\\s+—\\s+\\S`));
    }
  });

  it('[checkpoint: checkup-report] AC-02 — a healthy machine exits 0 with every fact ok', async () => {
    // Health is simulated through the documented CHECKUP_* overrides so the
    // check is reproducible in CI without touching the machine.
    const postgres = await openListener();
    try {
      const result = pnpm(['checkup'], {
        timeoutMs: 120_000,
        env: { CHECKUP_PG_PORT: String(postgres.port) },
      });
      for (const fact of CHECKUP_FACTS) {
        expect(checkupFactOk(result.output, fact), `fact "${fact}" not ok:\n${result.output}`).toBe(true);
      }
      expect(result.status, result.output).toBe(0);
    } finally {
      await postgres.close();
    }
  });
});

describe('AC-03 — checkup is not fail-fast', () => {
  it('an unreachable Postgres fails by name while every other fact is still reported', async () => {
    const deadPort = await closedPort();
    const result = pnpm(['checkup'], {
      timeoutMs: 120_000,
      env: { CHECKUP_PG_PORT: String(deadPort) },
    });

    expect(result.status, result.output).not.toBe(0);
    expect(checkupFactFailed(result.output, 'postgres-5544'), result.output).toBe(true);

    // V-CHECKUP is a report: the other seven facts still appear.
    for (const fact of CHECKUP_FACTS) {
      if (fact === 'postgres-5544') continue;
      expect(checkupFactLine(result.output, fact), `fact "${fact}" was swallowed:\n${result.output}`).toBeDefined();
    }
  });
});
