/**
 * Toolchain pins: the versions this machine actually runs, against the
 * versions the repository pins. CHECKUP_NODE_VERSION / CHECKUP_PNPM_VERSION
 * override the *observed* version so a mismatch can be simulated without
 * touching the machine.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const clean = (version) => String(version ?? '').trim().replace(/^v/, '')

/** A pin of `24` accepts any 24.x; a pin of `24.19.0` accepts exactly that. */
const matchesPin = (actual, pin) => {
  const pinParts = clean(pin).split('.')
  const actualParts = clean(actual).split('.')
  return pinParts.every((part, index) => actualParts[index] === part)
}

const nodePin = () => clean(readFileSync(resolve(repoRoot, '.nvmrc'), 'utf8'))

const pnpmPin = () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
  return clean(String(pkg.packageManager ?? '').replace(/^pnpm@/, ''))
}

const observedPnpm = () => {
  const override = process.env.CHECKUP_PNPM_VERSION
  if (override !== undefined && override !== '') return clean(override)
  const agent = /pnpm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent ?? '')
  if (agent !== null) return clean(agent[1])
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8', cwd: repoRoot })
  return clean(result.stdout)
}

export const facts = [
  {
    name: 'node-pin',
    check: () => {
      const pin = nodePin()
      const actual = clean(process.env.CHECKUP_NODE_VERSION ?? process.versions.node)
      const ok = actual !== '' && matchesPin(actual, pin)
      return {
        ok,
        detail: ok
          ? `node ${actual} matches the .nvmrc pin ${pin}`
          : `node ${actual === '' ? '(not detected)' : actual} does not match the .nvmrc pin ${pin}`,
      }
    },
  },
  {
    name: 'pnpm-pin',
    check: () => {
      const pin = pnpmPin()
      const actual = observedPnpm()
      const ok = actual !== '' && matchesPin(actual, pin)
      return {
        ok,
        detail: ok
          ? `pnpm ${actual} matches the packageManager pin ${pin}`
          : `pnpm ${actual === '' ? '(not detected)' : actual} does not match the packageManager pin ${pin}`,
      }
    },
  },
  {
    name: 'uv-present',
    check: () => {
      const binary = process.env.CHECKUP_UV_BIN ?? 'uv'
      const result = spawnSync(binary, ['--version'], { encoding: 'utf8' })
      const version = clean(result.stdout).split('\n')[0] ?? ''
      const ok = result.status === 0 && version !== ''
      return {
        ok,
        detail: ok ? `${version} on PATH` : `\`${binary} --version\` did not run (python toolchain missing)`,
      }
    },
  },
]
