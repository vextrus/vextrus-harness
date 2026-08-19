/** AC-11: the default lane is green, and green means the breaker did not run. */
import { beforeAll, describe, expect, test } from 'vitest';

import { ensureBrowsers, hasLine, lane } from './support';

describe('AC-11 `pnpm e2e` with no flags', () => {
  beforeAll(() => {
    ensureBrowsers();
  });

  test('exits 0, having run journeys but not the @breaker ones', () => {
    const result = lane([]);

    // The breaker journey fails by construction (AC-08). A default run that
    // executed it could not exit 0 — so exit 0 *is* the exclusion.
    expect(result.status, `pnpm e2e failed:\n${result.output}`).toBe(0);
    expect(hasLine(result.output, 'e2e: build'), `the lane never built:\n${result.output}`).toBe(
      true,
    );
    expect(
      hasLine(result.output, 'e2e: web ready on 3211'),
      `the lane never started the app:\n${result.output}`,
    ).toBe(true);
  });
});
