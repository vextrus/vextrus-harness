/**
 * Postgres reachability on 5544 — a raw TCP connect, so checkup needs no
 * driver dependency. CHECKUP_PG_PORT redirects the probe to another port so
 * "unreachable" can be simulated against a closed port; when it is set the
 * probe stays TCP-only, because that is what the simulation is asserting.
 * Otherwise a local unix socket also counts as reachable.
 */
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'

const DEFAULT_PORT = 5544
const TIMEOUT_MS = 2_000

const connect = (options) =>
  new Promise((resolve) => {
    const socket = createConnection({ ...options, timeout: TIMEOUT_MS })
    const settle = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => { settle({ ok: true }) })
    socket.once('timeout', () => { settle({ ok: false, reason: `no answer within ${TIMEOUT_MS}ms` }) })
    socket.once('error', (error) => { settle({ ok: false, reason: error.message }) })
  })

export const facts = [
  {
    name: `postgres-${DEFAULT_PORT}`,
    check: async () => {
      const override = process.env.CHECKUP_PG_PORT
      const port = Number(override ?? DEFAULT_PORT)
      const tcp = await connect({ host: '127.0.0.1', port })
      if (tcp.ok) return { ok: true, detail: `reachable over TCP on 127.0.0.1:${port}` }

      if (override !== undefined && override !== '') {
        return { ok: false, detail: `nothing accepting connections on 127.0.0.1:${port} — ${tcp.reason}` }
      }

      const socketDir = process.env.CHECKUP_PG_SOCKET_DIR ?? '/var/run/postgresql'
      const socketPath = join(socketDir, `.s.PGSQL.${port}`)
      if (existsSync(socketPath)) {
        const unix = await connect({ path: socketPath })
        if (unix.ok) return { ok: true, detail: `reachable over the unix socket ${socketPath}` }
        return { ok: false, detail: `TCP ${port}: ${tcp.reason}; socket ${socketPath}: ${unix.reason}` }
      }

      return { ok: false, detail: `unreachable on port ${port} (${tcp.reason}) and no socket at ${socketPath}` }
    },
  },
]
