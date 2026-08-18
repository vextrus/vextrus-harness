/**
 * V-VERIFY stage 4: unit and contract tests.
 *
 * `tests/e2e` is deliberately not in this lane — it boots a dev server, which
 * would spend the Q-01 budget on a boot and contend for port 3210. The child is
 * marked as nested so contract tests that drive `pnpm verify` do not recurse
 * into another full lane.
 */
import { runStage } from './_stage.mjs';

runStage('pnpm', ['exec', 'vitest', 'run', 'src/lint', 'tests/contract'], {
  VEXTRUS_ACCEPTANCE_NESTED: '1',
});
