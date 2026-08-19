/**
 * Fixture test for the Q-01 clock (Q-01: every guardrail proves it fires).
 *
 * `V-VERIFY green, ≤ 60 s local, no cache` is a budget, and a budget nothing
 * measures is a budget a later increment walks past without anyone noticing. So
 * the judgement is a function with an answer — measured against, exceeded by,
 * enforced or not — and this is where it is shown to give the right one at the
 * edge, without spending a whole verify run to find out.
 */
import { describe, expect, test } from 'vitest';

import { budgetVerdict } from '../../scripts/lib/stage.mjs';

/**
 * An environment with nothing in it but what a case puts there — never the real
 * one, so a `VERIFY_BUDGET_*` set in this shell cannot decide the verdict under
 * test. `NODE_ENV` is carried because the process env type requires it, and the
 * verdict never reads it.
 */
const env = (overrides: Record<string, string>): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  ...overrides,
});

describe('the Q-01 budget verdict', () => {
  test('a run inside the default 60 s budget is not over it', () => {
    expect(budgetVerdict('12.3', env({}))).toEqual({
      budget: 60,
      exceeded: false,
      enforced: false,
    });
  });

  test('the budget is ≤, so exactly 60 s is inside it', () => {
    expect(budgetVerdict('60.0', env({})).exceeded).toBe(false);
    expect(budgetVerdict('60.1', env({})).exceeded).toBe(true);
  });

  test('an over-budget run is reported, and by default still not failed', () => {
    const verdict = budgetVerdict('91.4', env({ VERIFY_BUDGET_SECONDS: '60' }));

    expect(verdict.exceeded).toBe(true);
    expect(verdict.enforced).toBe(false);
  });

  test('a caller that wants the clock to be a hard edge gets one', () => {
    const enforcing = env({ VERIFY_BUDGET_SECONDS: '60', VERIFY_BUDGET_ENFORCE: '1' });

    expect(budgetVerdict('91.4', enforcing).enforced).toBe(true);
    expect(budgetVerdict('12.0', enforcing).enforced).toBe(false);
    expect(budgetVerdict('91.4', env({ VERIFY_BUDGET_ENFORCE: '0' })).enforced).toBe(false);
  });

  test('the budget can be moved, and a run is judged against the moved one', () => {
    expect(budgetVerdict('91.4', env({ VERIFY_BUDGET_SECONDS: '120' })).exceeded).toBe(false);
    expect(budgetVerdict('12.0', env({ VERIFY_BUDGET_SECONDS: '10' })).exceeded).toBe(true);
  });

  test('a budget of zero or nonsense judges nothing rather than inventing a number', () => {
    for (const value of ['0', '', 'soon', '-5']) {
      const verdict = budgetVerdict('999.0', env({ VERIFY_BUDGET_SECONDS: value }));

      expect(verdict.budget, value).toBeUndefined();
      expect(verdict.exceeded, value).toBe(false);
    }
  });
});
