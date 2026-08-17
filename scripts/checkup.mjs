#!/usr/bin/env node
/**
 * V-CHECKUP — the machine's report, run at session start.
 *
 * Every file in scripts/checkup.d contributes facts; a later increment adds a
 * fact by adding a file. Unlike verify, checkup is deliberately NOT fail-fast:
 * one broken machine fact must never hide the state of the others. The exit
 * code is non-zero when any fact failed, after every fact has been reported.
 *
 * Line format: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`.
 */
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const factsDir = join(scriptsDir, 'checkup.d')
const repoRoot = resolve(scriptsDir, '..')

const messageOf = (error) => (error instanceof Error ? error.message : String(error))

const report = (ok, name, detail) => {
  const text = String(detail ?? '').replace(/\s+/g, ' ').trim()
  process.stdout.write(`${ok ? 'ok' : 'FAIL'} ${name} — ${text === '' ? 'no detail reported' : text}\n`)
  return ok
}

const files = readdirSync(factsDir)
  .filter((file) => file.endsWith('.mjs'))
  .sort()

let allOk = true

for (const file of files) {
  const fallbackName = file.replace(/\.mjs$/, '').replace(/^\d+[-_]?/, '')
  let facts
  try {
    const module = await import(pathToFileURL(join(factsDir, file)).href)
    const exported = module.facts ?? module.default ?? []
    facts = Array.isArray(exported) ? exported : [exported]
  } catch (error) {
    allOk = report(false, fallbackName, `fact module could not be loaded: ${messageOf(error)}`) && allOk
    continue
  }

  for (const fact of facts) {
    const name = typeof fact?.name === 'string' && fact.name !== '' ? fact.name : fallbackName
    if (typeof fact?.check !== 'function') {
      allOk = report(false, name, 'fact module exposes no check() function') && allOk
      continue
    }
    try {
      const outcome = await fact.check({ repoRoot, env: process.env })
      allOk = report(outcome?.ok === true, name, outcome?.detail) && allOk
    } catch (error) {
      allOk = report(false, name, `check threw: ${messageOf(error)}`) && allOk
    }
  }
}

process.exit(allOk ? 0 : 1)
