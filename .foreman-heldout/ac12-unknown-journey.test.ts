/**
 * AC-12: an unknown journey is refused before any work is done — no build, and
 * a scratch database that is exactly as it was (same oid, or still absent).
 */
import { describe, expect, test } from 'vitest';

import { hasLine, lane, scratchOid } from './support';

describe('AC-12 `pnpm e2e --journey J-999`', () => {
  test('exits 3 saying so, without building or recreating the scratch database', async () => {
    const before = await scratchOid();

    const result = lane(['--journey', 'J-999']);

    expect(result.status, `expected exit 3, got ${String(result.status)}:\n${result.output}`).toBe(
      3,
    );
    expect(
      hasLine(result.output, 'e2e: no journey J-999'),
      `the refusal never printed \`e2e: no journey J-999\`:\n${result.output}`,
    ).toBe(true);
    expect(
      hasLine(result.output, 'e2e: build'),
      `the refusal built the app first:\n${result.output}`,
    ).toBe(false);

    expect(
      await scratchOid(),
      'the refusal dropped or created the scratch database',
    ).toStrictEqual(before);
  });
});
