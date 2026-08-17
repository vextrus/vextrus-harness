import { join } from 'node:path';
import { socketReachable, tcpReachable } from '../lib/probe.mjs';

/**
 * A raw socket connect, not a driver: V-CHECKUP must not drag a database client
 * into the toolchain.
 *
 * The default probe is TCP 127.0.0.1:5544 with a fallback to the unix socket a
 * local cluster may be listening on instead — either transport answering means
 * Postgres is there, and the detail says which one did.
 *
 * `CHECKUP_PG_PORT` exists so failure can be simulated without touching the
 * machine; when it is set the probe is TCP-only, so pointing it at a closed
 * port fails deterministically.
 */
const DEFAULT_PORT = 5544;
const OVERRIDE = process.env.CHECKUP_PG_PORT ?? '';
const SOCKET_DIR = process.env.CHECKUP_PG_SOCKET_DIR ?? '/var/run/postgresql';

export const facts = [
  {
    name: 'postgres-5544',
    check: async () => {
      if (OVERRIDE.length > 0) return tcpReachable('127.0.0.1', Number(OVERRIDE));

      const tcp = await tcpReachable('127.0.0.1', DEFAULT_PORT);
      if (tcp.ok) return tcp;

      const path = join(SOCKET_DIR, `.s.PGSQL.${DEFAULT_PORT}`);
      const unix = await socketReachable(path);
      if (unix.ok) return unix;

      return { ok: false, detail: `${tcp.detail}; ${unix.detail}` };
    },
  },
];
