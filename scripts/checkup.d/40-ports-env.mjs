/**
 * The rest of the machine: the two application ports, the storage root, and
 * the environment. Ports are probed by actually binding and then closing —
 * a leaked socket would make the next run lie.
 */
import { accessSync, constants, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Environment variables this milestone requires; later increments extend the list. */
const REQUIRED_ENV = []

const bindable = (port) =>
  new Promise((resolve_) => {
    const server = createServer()
    const finish = (result) => {
      server.close(() => { resolve_(result) })
    }
    server.once('error', (error) => {
      // The listen failed, so there is nothing open to close here.
      resolve_({ ok: false, reason: error.message })
    })
    server.listen(port, '127.0.0.1', () => { finish({ ok: true }) })
  })

const portFact = (port) => ({
  name: `port-${port}`,
  check: async () => {
    const result = await bindable(port)
    return {
      ok: result.ok,
      detail: result.ok
        ? `bindable on 127.0.0.1:${port}`
        : `already taken on 127.0.0.1:${port} — ${result.reason}`,
    }
  },
})

export const facts = [
  portFact(3210),
  portFact(3211),
  {
    name: 'storage-root',
    check: () => {
      const override = process.env.CHECKUP_STORAGE_ROOT
      const root = override !== undefined && override !== '' ? resolve(override) : resolve(repoRoot, '.storage')
      // The repository-local default is provisioned; an explicit root is the
      // operator's (or the simulation's) to provide, and is only inspected.
      if (override === undefined || override === '') {
        try {
          mkdirSync(root, { recursive: true })
        } catch (error) {
          return { ok: false, detail: `${root} could not be created — ${error.message}` }
        }
      }
      try {
        if (!statSync(root).isDirectory()) return { ok: false, detail: `${root} exists but is not a directory` }
        accessSync(root, constants.W_OK)
        return { ok: true, detail: `${root} exists and is writable` }
      } catch (error) {
        return { ok: false, detail: `${root} is missing or not writable — ${error.message}` }
      }
    },
  },
  {
    name: 'env',
    check: () => {
      const missing = REQUIRED_ENV.filter((name) => {
        const value = process.env[name]
        return value === undefined || value === ''
      })
      const checked = REQUIRED_ENV.length === 0 ? 'none required at this milestone' : REQUIRED_ENV.join(', ')
      return {
        ok: missing.length === 0,
        detail: missing.length === 0
          ? `${REQUIRED_ENV.length} required variables present (${checked})`
          : `missing: ${missing.join(', ')}`,
      }
    },
  },
]
