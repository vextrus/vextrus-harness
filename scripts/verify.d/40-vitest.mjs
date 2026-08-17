/**
 * The repository's own tests. VEXTRUS_ACCEPTANCE_NESTED marks this as a child
 * run so an acceptance test that shells out to `pnpm verify` cannot re-enter
 * itself, and the unit lane keeps the run to the repository's tests plus any
 * scratch test a failure-injection has dropped in.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const bin = (name) => resolve(repoRoot, 'node_modules', '.bin', name)

const run = (name, args, env = {}) => {
  const result = spawnSync(bin(name), args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '0', NEXT_TELEMETRY_DISABLED: '1', ...env },
  })
  process.exit(result.status ?? 1)
}

run('vitest', ['run'], { VITEST_LANE: 'unit', VEXTRUS_ACCEPTANCE_NESTED: '1', CI: '1' })
