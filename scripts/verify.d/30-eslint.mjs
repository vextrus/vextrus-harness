/** V-VERIFY stage 3: the guardrails, including the repo's own custom rules. */
import { runStage } from './_stage.mjs';

runStage('pnpm', ['exec', 'eslint', '.', '--max-warnings', '0']);
