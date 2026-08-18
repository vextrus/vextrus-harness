/** `eslint .` — the guardrail rules, loaded from src/lint/rules. No cache. */
import { runBin } from '../lib/stage.mjs';

runBin('eslint', ['.', '--max-warnings', '0']);
