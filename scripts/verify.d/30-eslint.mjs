/** Guardrail rules, discovered by the loader — including the Q-08 tokens. */
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

run('eslint', ['.'])
