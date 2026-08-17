/**
 * V-CHECKUP facts: the ports this project claims, the storage root, the env.
 *
 * Ports are probed by actually binding and closing again — a lie here costs a
 * whole debugging session later. The bind is retried briefly so a dev server
 * that has only just been signalled does not read as a permanent conflict.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Keys this increment needs; later increments append to this list. */
const REQUIRED_ENV = [];
const KNOWN_NODE_ENVS = new Set(['development', 'test', 'production']);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bindOnce(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error) => resolve({ ok: false, why: error.message }));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve({ ok: true, why: 'bindable' }));
    });
  });
}

async function portFact(port) {
  let last = { ok: false, why: 'not probed' };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await bindOnce(port);
    if (last.ok) break;
    await wait(300);
  }
  return { name: `port-${port}`, ok: last.ok, detail: `127.0.0.1:${port} ${last.why}` };
}

function storageRootFact() {
  const override = process.env.CHECKUP_STORAGE_ROOT;
  const root = override ?? `${repoRoot}var/storage`;
  try {
    // The project's own default is ours to create; an override is a machine
    // fact we only observe, so a simulated failure stays a failure.
    if (override === undefined) mkdirSync(root, { recursive: true });
    const probe = `${root}/.checkup-write-probe`;
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    return { name: 'storage-root', ok: true, detail: `${root} exists and is writable` };
  } catch (error) {
    return { name: 'storage-root', ok: false, detail: `${root} unusable: ${String(error)}` };
  }
}

function envFact() {
  const missing = REQUIRED_ENV.filter((key) => (process.env[key] ?? '') === '');
  const nodeEnv = process.env.NODE_ENV;
  const nodeEnvOk = nodeEnv === undefined || KNOWN_NODE_ENVS.has(nodeEnv);
  const ok = missing.length === 0 && nodeEnvOk;
  const detail = ok
    ? `${missing.length} of ${REQUIRED_ENV.length} required keys missing, NODE_ENV=${nodeEnv ?? 'unset'}`
    : missing.length > 0
      ? `missing: ${missing.join(', ')}`
      : `NODE_ENV=${String(nodeEnv)} is not one of ${[...KNOWN_NODE_ENVS].join('/')}`;
  return { name: 'env', ok, detail };
}

export async function check() {
  return [await portFact(3210), await portFact(3211), storageRootFact(), envFact()];
}
