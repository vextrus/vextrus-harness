/** Ports, storage root and env: what the app needs from the machine to run. */
import { accessSync, constants, statSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { REPO_ROOT, finish, report } from '../lib/fact.mjs';

/** Bind for real and close cleanly — a leaked socket makes the next run lie. */
function bindable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      server.close();
      resolve(error.code ?? error.message);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(undefined));
    });
  });
}

for (const port of [3210, 3211]) {
  const reason = await bindable(port);
  report(
    reason === undefined,
    `port-${port}`,
    reason === undefined ? `bindable on 127.0.0.1:${port}` : `in use (${reason})`,
  );
}

const storageRoot = path.resolve(
  REPO_ROOT,
  process.env.CHECKUP_STORAGE_ROOT ?? process.env.VEXTRUS_STORAGE_ROOT ?? '.storage',
);
let storageDetail = `${storageRoot} exists and is writable`;
let storageOk = true;
try {
  if (!statSync(storageRoot).isDirectory()) throw new Error('not a directory');
  accessSync(storageRoot, constants.W_OK);
  const probeFile = path.join(storageRoot, `.checkup-${process.pid}`);
  writeFileSync(probeFile, 'probe');
  unlinkSync(probeFile);
} catch (error) {
  storageOk = false;
  storageDetail = `${storageRoot} ${error.code ?? error.message}`;
}
report(storageOk, 'storage-root', storageDetail);

/** M0 requires no variables yet; later increments extend the list. */
const required = (process.env.CHECKUP_REQUIRED_ENV ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '');
const missing = required.filter((name) => (process.env[name] ?? '') === '');
report(
  missing.length === 0,
  'env',
  missing.length === 0
    ? `${required.length} required variable(s) present`
    : `missing ${missing.join(', ')}`,
);

finish();
