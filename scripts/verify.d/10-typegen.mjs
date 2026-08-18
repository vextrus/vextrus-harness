/** V-VERIFY stage 1: route types, generated into verify's own distDir. */
import { runStage } from './_stage.mjs';

runStage('pnpm', ['exec', 'next', 'typegen']);
