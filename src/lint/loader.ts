/**
 * Auto-discovery for the repository's custom lint rules.
 *
 * A later increment adds a guardrail by dropping a file into this directory —
 * it never edits eslint.config.ts. Each module exports `{ rule, files,
 * severity }`; the file's basename is the rule name under the `vextrus`
 * namespace, and the directory scan happens on every load so a newly written
 * file is picked up without a restart.
 */
import type { Rule } from 'eslint'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export type RuleRegistration = {
  name: string
  rule: Rule.RuleModule
  files: string[]
  severity: 'error' | 'warn'
}

/** Plugin namespace under which every discovered rule is registered. */
export const NAMESPACE = 'vextrus'

const rulesDirectory = fileURLToPath(new URL('./rules/', import.meta.url))

const requireModule = createRequire(import.meta.url)

type LoadedModule = {
  rule?: unknown
  files?: unknown
  severity?: unknown
}

const loadModule = (path: string): LoadedModule => {
  delete requireModule.cache[path]
  return requireModule(path) as LoadedModule
}

const isRuleModule = (value: unknown): value is Rule.RuleModule =>
  typeof value === 'object' && value !== null && typeof (value as Rule.RuleModule).create === 'function'

const isFileGlobs = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')

const isSeverity = (value: unknown): value is 'error' | 'warn' => value === 'error' || value === 'warn'

export function loadRules(): RuleRegistration[] {
  const entries = readdirSync(rulesDirectory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .sort()

  return entries.map((entry) => {
    const name = entry.slice(0, -'.ts'.length)
    const loaded = loadModule(rulesDirectory + entry)

    if (!isRuleModule(loaded.rule)) {
      throw new Error(`lint rule ${name} must export a \`rule\` with a create() function`)
    }
    if (!isFileGlobs(loaded.files)) {
      throw new Error(`lint rule ${name} must export a non-empty \`files\` glob array`)
    }
    if (!isSeverity(loaded.severity)) {
      throw new Error(`lint rule ${name} must export \`severity\` of 'error' or 'warn'`)
    }

    return { name, rule: loaded.rule, files: [...loaded.files], severity: loaded.severity }
  })
}
