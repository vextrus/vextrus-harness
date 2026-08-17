#!/usr/bin/env node
/**
 * V-VERIFY — the whole contract in one exit code.
 *
 * Every stage is a file in scripts/verify.d, run in filename order, fail-fast.
 * A later increment adds a stage by adding a file: this orchestrator never
 * learns a stage's name. Wall time is printed at the end of every run.
 *
 * VERIFY_ONLY=<prefix> narrows the run to a single stage, for debugging.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptsDir, '..')
const stagesDir = join(scriptsDir, 'verify.d')

/** A stage file name without its ordering prefix: the name printed as it runs. */
const stageName = (file) => file.replace(/\.mjs$/, '').replace(/^\d+[-_]?/, '')

const only = process.env.VERIFY_ONLY?.trim()

const matchesOnly = (file) => {
  if (only === undefined || only === '') return true
  return file.startsWith(only) || stageName(file).startsWith(only)
}

const stages = readdirSync(stagesDir)
  .filter((file) => file.endsWith('.mjs'))
  .sort()
  .filter(matchesOnly)

if (stages.length === 0) {
  process.stdout.write(`no stages matched ${only ?? ''}\n`)
  process.exit(1)
}

const seconds = (ms) => (ms / 1000).toFixed(3)

const startedAt = Date.now()
let failure

for (const file of stages) {
  const name = stageName(file)
  process.stdout.write(`== ${name}\n`)
  const stageStartedAt = Date.now()
  const result = spawnSync(process.execPath, [join(stagesDir, file)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const status = result.status ?? 1
  if (status !== 0) {
    failure = { name, status }
    break
  }
  process.stdout.write(`   ${name} ok (${seconds(Date.now() - stageStartedAt)}s)\n`)
}

if (failure !== undefined) {
  process.stdout.write(`   ${failure.name} FAILED (exit ${failure.status})\n`)
}
process.stdout.write(`total ${seconds(Date.now() - startedAt)}s\n`)

process.exit(failure === undefined ? 0 : failure.status)
