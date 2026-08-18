/** The strict compiler over the whole tree; no incremental build info exists. */
import { runBin } from '../lib/stage.mjs';

runBin('tsc', ['--noEmit']);
