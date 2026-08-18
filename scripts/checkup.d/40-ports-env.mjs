/**
 * V-CHECKUP: the places the app needs to put things — its two ports, its
 * storage root, its environment.
 *
 * Ports are proven by actually binding and closing them; a probe that leaked a
 * socket would make the next run lie. `CHECKUP_STORAGE_ROOT` moves the storage
 * root so an unusable one can be simulated without touching the machine.
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const WEB_PORT = 3210;
const E2E_PORT = 3211;

/** Required at M0: nothing yet. Later increments extend this list. */
const REQUIRED_ENV = [];

function bindable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      server.close();
      resolve({ ok: false, reason: error.code ?? error.message });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve({ ok: true }));
    });
  });
}

function portCheck(port, purpose) {
  return async () => {
    const outcome = await bindable(port);
    if (outcome.ok) return { ok: true, detail: `127.0.0.1:${port} free to bind (${purpose})` };
    return { ok: false, detail: `127.0.0.1:${port} not bindable: ${outcome.reason} (${purpose})` };
  };
}

function storageRoot({ root, env }) {
  const override = env['CHECKUP_STORAGE_ROOT'];
  const dir = override ?? path.join(root, '.storage');
  const probe = path.join(dir, `.checkup-${String(process.pid)}`);
  try {
    // The default root belongs to this repo, so checkup creates it. An operator
    // who points the root somewhere else is asking about *that* place: it is
    // reported as found, never conjured into existence.
    if (override === undefined) {
      mkdirSync(dir, { recursive: true });
    } else if (!statSync(dir).isDirectory()) {
      return { ok: false, detail: `${dir} is not a directory` };
    }
    writeFileSync(probe, 'checkup');
    rmSync(probe, { force: true });
  } catch (error) {
    return {
      ok: false,
      detail: `${dir} not usable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true, detail: `${dir} exists and is writable` };
}

function environment({ env }) {
  const missing = REQUIRED_ENV.filter((name) => (env[name] ?? '') === '');
  if (missing.length > 0) {
    return { ok: false, detail: `missing ${missing.join(', ')}` };
  }
  return {
    ok: true,
    detail: `${String(REQUIRED_ENV.length)} required variable(s) present, none missing`,
  };
}

export const checks = [
  { name: 'port-3210', check: portCheck(WEB_PORT, 'web dev server') },
  { name: 'port-3211', check: portCheck(E2E_PORT, 'e2e lane server') },
  { name: 'storage-root', check: storageRoot },
  { name: 'env', check: environment },
];
