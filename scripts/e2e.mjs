#!/usr/bin/env node
/**
 * Journey segments: `pnpm e2e --journey <J>` runs `tests/e2e/*.e2e.ts`, which
 * drive the real entry points (`pnpm dev`, `pnpm verify`).
 */
import { runBin } from './lib/stage.mjs';

const args = process.argv.slice(2);
const journeyIndex = args.indexOf('--journey');
const journey = journeyIndex >= 0 ? args[journeyIndex + 1] : undefined;

process.stdout.write(`e2e — journey ${journey ?? 'all'}\n`);

process.exit(runBin('vitest', ['run', '--no-cache', '--config', 'vitest.acceptance.config.ts']));
