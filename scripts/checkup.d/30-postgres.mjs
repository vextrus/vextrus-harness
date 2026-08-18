/** A raw TCP connect — the database's own driver is not a dependency of checkup. */
import { connect } from 'node:net';

import { report, summarise } from '../lib/report.mjs';

const CONTRACT_PORT = 5544;
const port = Number(process.env['CHECKUP_PG_PORT'] ?? CONTRACT_PORT);
const host = process.env['CHECKUP_PG_HOST'] ?? '127.0.0.1';

const reachable = await new Promise((resolve) => {
  const socket = connect({ host, port });
  const finish = (value) => {
    socket.destroy();
    resolve(value);
  };
  socket.setTimeout(2000);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

process.exit(
  summarise([
    report(
      `postgres-${CONTRACT_PORT}`,
      reachable,
      reachable ? `reachable at ${host}:${port}` : `nothing listening at ${host}:${port}`,
    ),
  ]),
);
