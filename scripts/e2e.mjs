#!/usr/bin/env node
/**
 * The journey lane: `pnpm e2e --journey J-000` runs the journey tests against
 * a real server. Journeys are selected by id; with no id, every journey runs.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const journeyIndex = args.indexOf('--journey')
const journey = journeyIndex >= 0 ? args[journeyIndex + 1] : undefined

/** Journey ids map to the journeys this increment ships. */
const JOURNEYS = {
  'J-000': [],
}

if (journey !== undefined && !(journey in JOURNEYS)) {
  process.stdout.write(`unknown journey ${journey}\n`)
  process.exit(1)
}

const filters = journey === undefined ? [] : JOURNEYS[journey]

const result = spawnSync(resolve(repoRoot, 'node_modules', '.bin', 'vitest'), ['run', ...filters], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, VITEST_LANE: 'e2e', FORCE_COLOR: '0' },
})

process.exit(result.status ?? 1)
