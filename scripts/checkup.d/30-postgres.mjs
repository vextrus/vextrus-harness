/** Postgres reachability: a raw TCP connect, no driver dependency. */
import net from 'node:net';

import { finish, report } from '../lib/fact.mjs';

const port = Number(process.env.CHECKUP_PG_PORT ?? '5544');
const host = process.env.CHECKUP_PG_HOST ?? '127.0.0.1';

/** Resolves with the failure reason, or undefined when the port answers. */
function probe() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (reason) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(reason);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => done(undefined));
    socket.once('timeout', () => done('timed out'));
    socket.once('error', (error) => done(error.code ?? error.message));
  });
}

const reason = await probe();
report(
  reason === undefined,
  `postgres-${port}`,
  reason === undefined ? `reachable at ${host}:${port}` : `${host}:${port} ${reason}`,
);

finish();
