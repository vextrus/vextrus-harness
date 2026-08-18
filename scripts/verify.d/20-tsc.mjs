import { runBin } from '../lib/stage.mjs';

process.exitCode = runBin('tsc', ['--noEmit']);
