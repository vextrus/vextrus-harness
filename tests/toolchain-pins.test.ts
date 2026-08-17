/**
 * AC-07 — the pinned toolchain is pinned in fact, not just in prose.
 * Proves B-03 ("boring, mainstream, strongly typed") is enforced by config,
 * and underwrites Q-01's "no cache that can lie" by forbidding float ranges.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from './support/proc'

const readRoot = (name: string): string => readFileSync(resolve(repoRoot, name), 'utf8')
const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(readRoot(name).replace(/^\s*\/\/.*$/gm, '')) as Record<string, unknown>

describe('AC-07 pinned toolchain', () => {
  it('tsconfig.json enables strict, noUncheckedIndexedAccess and exactOptionalPropertyTypes', () => {
    const tsconfig = readJson('tsconfig.json')
    const options = tsconfig['compilerOptions'] as Record<string, unknown> | undefined
    expect(options, 'tsconfig.json must declare compilerOptions').toBeDefined()
    // AC-07: all three strictness switches are true, not merely present.
    expect(options?.['strict']).toBe(true)
    expect(options?.['noUncheckedIndexedAccess']).toBe(true)
    expect(options?.['exactOptionalPropertyTypes']).toBe(true)
  })

  it('.npmrc sets save-exact=true', () => {
    // AC-07: new installs cannot reintroduce a caret range.
    expect(readRoot('.npmrc')).toMatch(/^\s*save-exact\s*=\s*true\s*$/m)
  })

  it('.nvmrc pins Node 24', () => {
    // AC-07: Node 24 LTS pin, read by checkup's node-pin fact.
    expect(readRoot('.nvmrc').trim()).toMatch(/^v?24(\.\d+){0,2}$/)
  })

  it('package.json packageManager pins pnpm 10 to an exact version', () => {
    const pkg = readJson('package.json')
    const packageManager = pkg['packageManager']
    expect(typeof packageManager).toBe('string')
    // AC-07: exact x.y.z, no range, no bare major.
    expect(packageManager as string).toMatch(/^pnpm@10\.\d+\.\d+(\+[\w.-]+)?$/)
  })

  it('every dependency is an exact version — no ^ or ~ anywhere', () => {
    const pkg = readJson('package.json')
    const blocks = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    const floating: string[] = []
    for (const block of blocks) {
      const deps = pkg[block] as Record<string, string> | undefined
      if (deps === undefined) continue
      for (const [name, range] of Object.entries(deps)) {
        // AC-07: exact versions only (workspace:/catalog: protocols are not ranges).
        if (/^[\^~]/.test(range) || range === '*' || /\s-\s|\|\||\bx\b/.test(range)) {
          floating.push(`${block}.${name}=${range}`)
        }
      }
    }
    expect(floating, `floating ranges found: ${floating.join(', ')}`).toEqual([])
  })

  it('declares the Bible-pinned majors: Next 16, React 19, TypeScript 6, ESLint 10, Vitest 4', () => {
    const pkg = readJson('package.json')
    const all = {
      ...(pkg['dependencies'] as Record<string, string> | undefined),
      ...(pkg['devDependencies'] as Record<string, string> | undefined),
    }
    const majorOf = (name: string): number => {
      const range = all[name]
      expect(range, `${name} must be a declared dependency`).toBeDefined()
      return Number.parseInt((range as string).replace(/^\D*/, ''), 10)
    }
    // AC-07 / B-03: one boring, mainstream, pinned stack.
    expect(majorOf('next')).toBe(16)
    expect(majorOf('react')).toBe(19)
    expect(majorOf('react-dom')).toBe(19)
    expect(majorOf('typescript')).toBe(6)
    expect(majorOf('eslint')).toBe(10)
    expect(majorOf('vitest')).toBe(4)
  })

  it('package.json exposes the seven contract scripts', () => {
    const pkg = readJson('package.json')
    const scripts = pkg['scripts'] as Record<string, string> | undefined
    // Interfaces: package.json scripts: dev, build, test, verify, checkup, lint, typecheck
    for (const name of ['dev', 'build', 'test', 'verify', 'checkup', 'lint', 'typecheck']) {
      expect(scripts?.[name], `missing script: ${name}`).toBeTruthy()
    }
    expect(scripts?.['verify']).toContain('scripts/verify.mjs')
    expect(scripts?.['checkup']).toContain('scripts/checkup.mjs')
  })

  it('a frozen-lockfile install is possible: pnpm-lock.yaml is committed', () => {
    // AC-01 precondition: `pnpm install --frozen-lockfile` needs a lockfile in the tree.
    expect(existsSync(resolve(repoRoot, 'pnpm-lock.yaml'))).toBe(true)
  })
})
