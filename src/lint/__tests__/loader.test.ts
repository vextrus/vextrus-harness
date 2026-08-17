/**
 * AC-06 — the loader auto-discovers src/lint/rules/*.ts so that every later
 * increment adds a rule by dropping in a file, with no edit to the shared
 * eslint.config.ts (B-03: extension without editing shared files).
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadRules, type RuleRegistration } from '../loader'

const repoRoot = process.cwd()
const rulesDir = resolve(repoRoot, 'src/lint/rules')

const byName = (registrations: readonly RuleRegistration[], name: string): RuleRegistration | undefined =>
  registrations.find((registration) => registration.name === name)

describe('AC-06 lint rule loader', () => {
  it('discovers the shipped rule and registers its { rule, files, severity }', () => {
    const registrations = loadRules()
    const found = byName(registrations, 'no-forbidden-escapes')

    // Interfaces: loadRules(): RuleRegistration[] discovering src/lint/rules/*.ts.
    expect(found, `loadRules() returned: ${registrations.map((r) => r.name).join(', ')}`).toBeDefined()
    expect(found?.files).toEqual(['**/*.ts', '**/*.tsx'])
    expect(found?.severity).toBe('error')
    expect(typeof found?.rule.create).toBe('function')
  })

  it('every registration carries the full RuleRegistration shape', () => {
    for (const registration of loadRules()) {
      expect(typeof registration.name).toBe('string')
      expect(registration.name.length).toBeGreaterThan(0)
      expect(Array.isArray(registration.files)).toBe(true)
      expect(registration.files.length).toBeGreaterThan(0)
      expect(['error', 'warn']).toContain(registration.severity)
      expect(typeof registration.rule.create).toBe('function')
    }
  })

  it('picks up a newly dropped-in rule file with no config edit', () => {
    // AC-06: discovery is by directory scan, proven by adding a file at runtime.
    const probePath = resolve(rulesDir, 'zz-acceptance-probe.ts')
    const probeSource = [
      'import type { Rule } from "eslint"',
      'export const files = ["**/*.ts"]',
      'export const severity = "warn" as const',
      'export const rule: Rule.RuleModule = {',
      '  meta: { type: "problem", schema: [], messages: { probe: "probe" } },',
      '  create: () => ({}),',
      '}',
      '',
    ].join('\n')

    writeFileSync(probePath, probeSource, 'utf8')
    try {
      const probe = byName(loadRules(), 'zz-acceptance-probe')
      expect(probe, 'loader did not discover a newly added rule file').toBeDefined()
      expect(probe?.severity).toBe('warn')
      expect(probe?.files).toEqual(['**/*.ts'])
    } finally {
      rmSync(probePath, { force: true })
    }
  })

  it('eslint.config.ts names no individual rule file', () => {
    const config = readFileSync(resolve(repoRoot, 'eslint.config.ts'), 'utf8')

    // AC-06: the config wires the loader and the `vextrus` namespace only.
    expect(config).toMatch(/loadRules/)
    expect(config).toMatch(/vextrus/)
    expect(config, 'eslint.config.ts must not name a rule file').not.toContain('no-forbidden-escapes')
    expect(config, 'eslint.config.ts must not reach into the rules directory').not.toMatch(/rules\/[a-z0-9-]+/)
  })

  it('inline directives cannot suppress rules repo-wide', () => {
    const config = readFileSync(resolve(repoRoot, 'eslint.config.ts'), 'utf8')
    // Q-08: an ESLint disable directive must be reportable, so it must not be
    // able to switch the reporting rule off first.
    expect(config).toMatch(/noInlineConfig\s*:\s*true/)
  })
})
