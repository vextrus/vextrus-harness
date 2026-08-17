/**
 * AC-02 / AC-03 — V-CHECKUP: the machine's report.
 *
 * Every fact is named on its own line with an ok/FAIL marker, and checkup is
 * explicitly NOT fail-fast: one bad fact must not hide the rest. Failures are
 * simulated purely through CHECKUP_* env overrides so the machine is never
 * mutated and the run is reproducible in CI.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findClosedPort, pnpm, withListener } from './support/proc'

/** Interfaces: fact names are fixed, regardless of any port override. */
const FACT_NAMES = [
  'node-pin',
  'pnpm-pin',
  'uv-present',
  'postgres-5544',
  'port-3210',
  'port-3211',
  'storage-root',
  'env',
] as const

/** Interfaces: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`. */
const factLine = (name: string): RegExp => new RegExp(`^(ok|FAIL)\\s+${name}\\s+—\\s+\\S`, 'm')

const storageRoot = mkdtempSync(join(tmpdir(), 'vextrus-storage-'))
afterAll(() => { rmSync(storageRoot, { recursive: true, force: true }) })

describe('AC-02 checkup reports every fact by name', () => {
  it('names all eight facts, each on its own marked line, and exits 0 iff none failed', async () => {
    const pgPort = await findClosedPort()
    // Simulate a reachable Postgres by listening on the port checkup probes.
    const result = await withListener(pgPort, () =>
      pnpm(['checkup'], {
        CHECKUP_PG_PORT: String(pgPort),
        CHECKUP_STORAGE_ROOT: storageRoot,
      }),
    )

    // AC-02: every fact named, own line, ok/fail marker, detail.
    for (const name of FACT_NAMES) {
      expect(result.stdout, `missing fact line for ${name}\n${result.stdout}`).toMatch(factLine(name))
    }

    // AC-02: exit 0 on a healthy machine — stated as the invariant that holds
    // on any machine: the exit code is zero exactly when no fact failed.
    const anyFailed = /^FAIL\s+/m.test(result.stdout)
    expect(result.status === 0, `exit=${result.status} anyFailed=${anyFailed}\n${result.stdout}`).toBe(!anyFailed)

    // The two facts this test fully controls must be ok.
    expect(result.stdout).toMatch(/^ok\s+postgres-5544\s+—/m)
    expect(result.stdout).toMatch(/^ok\s+storage-root\s+—/m)
  })

  it('reports the pins with the versions it compared', async () => {
    const pgPort = await findClosedPort()
    const result = await withListener(pgPort, () =>
      pnpm(['checkup'], { CHECKUP_PG_PORT: String(pgPort), CHECKUP_STORAGE_ROOT: storageRoot }),
    )
    // AC-02: node version vs .nvmrc pin, pnpm version vs packageManager pin.
    expect(result.stdout).toMatch(/^ok\s+node-pin\s+—.*\b24\./m)
    expect(result.stdout).toMatch(/^ok\s+pnpm-pin\s+—.*\b10\./m)
  })
})

describe('AC-03 checkup is not fail-fast', () => {
  it('an unreachable Postgres fails by name while all other facts still report', async () => {
    const closedPort = await findClosedPort()
    const result = pnpm(['checkup'], {
      CHECKUP_PG_PORT: String(closedPort),
      CHECKUP_STORAGE_ROOT: storageRoot,
    })

    // AC-03: exits non-zero.
    expect(result.status, result.stdout).not.toBe(0)
    // AC-03: marks that fact as failed, by its contract name.
    expect(result.stdout, result.stdout).toMatch(/^FAIL\s+postgres-5544\s+—\s+\S/m)
    // AC-03: still reports all remaining facts.
    for (const name of FACT_NAMES) {
      expect(result.stdout, `checkup stopped early — ${name} missing\n${result.stdout}`).toMatch(factLine(name))
    }
  })

  it('an unwritable storage root fails by name without suppressing the report', async () => {
    const missingRoot = join(storageRoot, 'does', 'not', 'exist')
    const pgPort = await findClosedPort()
    const result = await withListener(pgPort, () =>
      pnpm(['checkup'], { CHECKUP_PG_PORT: String(pgPort), CHECKUP_STORAGE_ROOT: missingRoot }),
    )

    // AC-03: a second, independent fact demonstrates the same non-fail-fast rule.
    expect(result.status, result.stdout).not.toBe(0)
    expect(result.stdout).toMatch(/^FAIL\s+storage-root\s+—\s+\S/m)
    expect(result.stdout).toMatch(/^ok\s+postgres-5544\s+—/m)
    for (const name of FACT_NAMES) {
      expect(result.stdout, `${name} missing\n${result.stdout}`).toMatch(factLine(name))
    }
  })
})
