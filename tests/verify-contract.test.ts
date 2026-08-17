/**
 * AC-01 — `pnpm verify` is the whole contract: five named stages in filename
 * order, driven by drop-in files, ending in a total wall-time line.
 *
 * The full green run is measured by the gate (it would recurse if launched from
 * inside verify's own vitest stage); here we prove the stage inventory, the
 * ordering rule, and the single-stage debugging entry point end to end.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNestedRun, mentionsStage, pnpm, repoRoot } from './support/proc'

const verifyDir = resolve(repoRoot, 'scripts/verify.d')

/** The wall-time line AC-01 requires, e.g. "total 12.4s". */
const TOTAL_WALL_TIME = /total\s+\d+(\.\d+)?s/

describe('AC-01 verify stage inventory and ordering', () => {
  it('scripts/verify.mjs exists and is the only orchestrator', () => {
    // V-VERIFY: one entry point; exit code is the whole contract.
    expect(existsSync(resolve(repoRoot, 'scripts/verify.mjs'))).toBe(true)
  })

  it('ships exactly the five in-scope stages, named so filename order is V-VERIFY order', () => {
    const stages = readdirSync(verifyDir).filter((name) => name.endsWith('.mjs')).sort()
    // V-VERIFY: typegen -> tsc -> eslint -> vitest -> build.
    expect(stages).toEqual([
      '10-typegen.mjs',
      '20-tsc.mjs',
      '30-eslint.mjs',
      '40-vitest.mjs',
      '90-build.mjs',
    ])
  })

  it('verify.mjs discovers stages by directory scan, not by a hard-coded list', () => {
    const source = readFileSync(resolve(repoRoot, 'scripts/verify.mjs'), 'utf8')
    // AC-11 / "every later increment extends without editing shared files".
    expect(source).toMatch(/verify\.d/)
    expect(source, 'verify.mjs must scan the directory, not hard-code stages').toMatch(/readdir|glob|opendir/i)
    for (const stage of ['10-typegen', '20-tsc', '30-eslint', '40-vitest', '90-build']) {
      expect(source, `verify.mjs must not name ${stage} explicitly`).not.toContain(stage)
    }
  })

  it('the build stage builds into .next-verify, never the dev .next', () => {
    // The distDir may be set in the stage or passed through next.config.ts.
    const sources = ['scripts/verify.d/90-build.mjs', 'next.config.ts']
      .map((name) => readFileSync(resolve(repoRoot, name), 'utf8'))
      .join('\n')
    // V-VERIFY: "next build cold into its own distDir"; B-03: no cache that can lie.
    expect(sources, 'nothing configures the .next-verify distDir').toContain('.next-verify')
  })
})

// Spawning tests re-enter `pnpm verify`; refuse to register inside such a child.
if (!isNestedRun) {
  describe('AC-01 VERIFY_ONLY runs a single stage and still prints the wall time', () => {
    it('VERIFY_ONLY=10 runs typegen alone, exits 0, prints the total line', () => {
      const result = pnpm(['verify'], { VERIFY_ONLY: '10' })

      // AC-01: stage names are printed as the run proceeds.
      expect(mentionsStage(result.output, 'typegen'), result.output).toBe(true)
      // Interfaces: VERIFY_ONLY=<prefix> may run a single stage for debugging.
      expect(result.status, result.output).toBe(0)
      // AC-01: a final total wall time line.
      expect(result.output).toMatch(TOTAL_WALL_TIME)

      // The other four stages must be absent — this is the same absence signal
      // AC-04/AC-05 rely on, proven here against a known-good run.
      for (const stage of ['tsc', 'eslint', 'vitest', 'build']) {
        expect(mentionsStage(result.output, stage), `${stage} should not run\n${result.output}`).toBe(false)
      }
    })
  })
}
