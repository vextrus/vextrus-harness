import { runBin } from '../lib/stage.mjs';

process.exitCode = runBin('eslint', ['.', '--max-warnings', '0']);
