import { runBin } from '../lib/stage.mjs';

process.exit(runBin('eslint', ['.', '--max-warnings', '0']));
