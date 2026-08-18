/**
 * V-CHECKUP: the dev Postgres answers on 5544. A raw TCP connect, deliberately
 * — the report must not depend on a database driver being installed.
 * `CHECKUP_PG_PORT` moves the probed port so unreachability can be simulated.
 */
import net from 'node:net';

const DEFAULT_PORT = 5544;
const TIMEOUT_MS = 2_000;

function connect(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const settle = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => settle({ ok: true }));
    socket.once('timeout', () => settle({ ok: false, reason: 'timed out' }));
    socket.once('error', (error) => settle({ ok: false, reason: error.code ?? error.message }));
    socket.connect(port, host);
  });
}

async function postgres({ env }) {
  const port = Number(env['CHECKUP_PG_PORT'] ?? DEFAULT_PORT);
  const outcome = await connect('127.0.0.1', port);
  if (outcome.ok) return { ok: true, detail: `TCP 127.0.0.1:${port} accepted (default 5544)` };
  return {
    ok: false,
    detail: `TCP 127.0.0.1:${port} unreachable: ${outcome.reason} (default 5544)`,
  };
}

export const checks = [{ name: 'postgres-5544', check: postgres }];
