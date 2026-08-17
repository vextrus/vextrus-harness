/**
 * V-CHECKUP fact: Postgres answers on the project port, 5544.
 *
 * A raw connect, so checkup owes nothing to a driver. Both transports count: a
 * local cluster commonly listens only on its unix socket, and a fact that read
 * FAIL against a perfectly healthy database would be a lie of the worst kind.
 * CHECKUP_PG_PORT simulates an outage by pointing the probe at a port nothing
 * serves, rather than by stopping the server.
 */
import { connect } from 'node:net';

const DEFAULT_PORT = 5544;
const SOCKET_DIRS = ['/var/run/postgresql', '/tmp'];
const TIMEOUT_MS = 3_000;

/** Resolves to null on success, or the reason it failed. */
function probe(options) {
  return new Promise((resolve) => {
    const socket = connect(options);
    const finish = (reason) => {
      socket.destroy();
      resolve(reason);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => finish(null));
    socket.once('timeout', () => finish(`no answer within ${TIMEOUT_MS}ms`));
    socket.once('error', (error) => finish(error.message));
  });
}

function socketDirs() {
  const fromEnv = process.env.PGHOST;
  return fromEnv !== undefined && fromEnv.startsWith('/') ? [fromEnv, ...SOCKET_DIRS] : SOCKET_DIRS;
}

export async function check() {
  const port = Number(process.env.CHECKUP_PG_PORT ?? DEFAULT_PORT);
  const host = process.env.CHECKUP_PG_HOST ?? '127.0.0.1';

  const tcp = await probe({ host, port });
  if (tcp === null) {
    return [{ name: 'postgres-5544', ok: true, detail: `accepting connections on ${host}:${port}` }];
  }

  const tried = [`tcp ${host}:${port}: ${tcp}`];
  for (const dir of socketDirs()) {
    const path = `${dir}/.s.PGSQL.${port}`;
    const reason = await probe({ path });
    if (reason === null) {
      return [{ name: 'postgres-5544', ok: true, detail: `accepting connections on ${path}` }];
    }
    tried.push(`socket ${path}: ${reason}`);
  }

  return [{ name: 'postgres-5544', ok: false, detail: `unreachable — ${tried.join('; ')}` }];
}
