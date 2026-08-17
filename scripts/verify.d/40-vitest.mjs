/**
 * V-VERIFY stage 4: the test suite, no cache.
 *
 * The acceptance journeys shell out to `pnpm verify`; the marker tells that
 * nested layer to stand down so the recursion is bounded at one level.
 */
export const name = 'vitest';
export const bin = 'vitest';
export const args = ['run', '--no-cache'];
export const env = { VEXTRUS_ACCEPTANCE_NESTED: '1' };
