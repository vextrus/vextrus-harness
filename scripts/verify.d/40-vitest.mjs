/**
 * V-VERIFY stage 4: unit and contract tests.
 *
 * Every test in the tree runs except the journey lane, which boots a dev
 * server: it would spend the Q-01 budget on a boot and contend for port 3210.
 * Selecting by exclusion (rather than by listing lanes) means a test dropped
 * anywhere else in the tree is part of the contract the moment it exists. The
 * child is marked as nested so contract tests that drive `pnpm verify` do not
 * recurse into another full lane.
 */
import { runStage } from './_stage.mjs';

/** The journey lane, excluded here and run by `pnpm e2e`. */
const JOURNEY_LANE = `tests/e2e/${'**'}`;

runStage(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--exclude',
    '**/node_modules/**',
    '--exclude',
    '**/.next/**',
    '--exclude',
    '**/.next-verify/**',
    '--exclude',
    JOURNEY_LANE,
  ],
  {
    VEXTRUS_ACCEPTANCE_NESTED: '1',
  },
);
