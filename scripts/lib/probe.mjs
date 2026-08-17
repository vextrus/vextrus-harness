/** Shared probes for checkup facts. Not a fact file. */
import { connect, createServer } from 'node:net';

/** Can we actually bind this port? Bind, then close cleanly — a leaked socket
 *  would make the next checkup lie. */
export function portBindable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    const done = (result) => {
      server.removeAllListeners();
      resolve(result);
    };
    server.once('error', (error) => done({ ok: false, detail: `cannot bind: ${error.code ?? error.message}` }));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => done({ ok: true, detail: `bindable on 127.0.0.1:${port}` }));
    });
  });
}

/** Raw TCP reachability — no database driver, nothing to install. */
export function tcpReachable(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, detail: `accepting connections on ${host}:${port}` }));
    socket.once('timeout', () => finish({ ok: false, detail: `no answer from ${host}:${port} within ${timeoutMs}ms` }));
    socket.once('error', (error) =>
      finish({ ok: false, detail: `unreachable on ${host}:${port} (${error.code ?? error.message})` }),
    );
  });
}
