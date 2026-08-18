import { runBin } from '../lib/stage.mjs';

process.exit(runBin('tsc', ['--noEmit']));
