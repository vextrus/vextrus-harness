import { defineConfig } from 'vitest/config'

/**
 * Lanes, selected by VITEST_LANE:
 *   unit       — what `pnpm verify` runs: the repository's own tests plus any
 *                scratch test a failure-injection drops under src/.
 *   e2e        — the journey lane (`pnpm e2e`), which starts a real server.
 *   acceptance — the acceptance suite only.
 *   (unset)    — `pnpm test`: unit + acceptance, journeys excluded.
 *
 * Test files run one at a time: several of them inject scratch files into the
 * working tree and shell out to `pnpm verify`, which is only deterministic if
 * no other file is doing the same at the same moment.
 */
const JOURNEY_DIR = `tests/${'e2e'}`

const UNIT = [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  '**/*scratch*/**/*.test.ts',
  '**/*scratch*.test.ts',
]
const ACCEPTANCE = ['tests/**/*.test.ts']
const JOURNEYS = [`${JOURNEY_DIR}/**/*.test.ts`]

const lane = process.env['VITEST_LANE'] ?? 'all'

const include =
  lane === 'unit'
    ? UNIT
    : lane === 'e2e'
      ? JOURNEYS
      : lane === 'acceptance'
        ? ACCEPTANCE
        : [...UNIT, ...ACCEPTANCE]

const exclude = [
  '**/node_modules/**',
  '.next/**',
  '.next-verify/**',
  ...(lane === 'e2e' ? [] : [`${JOURNEY_DIR}/**`]),
]

export default defineConfig({
  test: {
    include,
    exclude,
    // B-03: no cache that can lie.
    cache: false,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
