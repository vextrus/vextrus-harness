/** V-VERIFY stage 2: the compiler, no emit, no incremental cache. */
import { runStage } from './_stage.mjs';

runStage('pnpm', ['exec', 'tsc', '--noEmit']);
