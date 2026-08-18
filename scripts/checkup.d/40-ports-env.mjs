/**
 * Ports are probed by really binding and really closing them: a leaked socket
 * makes the next run lie (risk note 3).
 */
import { accessSync, constants, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { repoRoot } from '../lib/stage.mjs';
import { report, summarise } from '../lib/report.mjs';

const bindable = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error) => resolve({ ok: false, detail: error.code ?? 'unavailable' }));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve({ ok: true, detail: 'bindable' }));
    });
  });

const results = [];

/**
 * The contract ports, with a test-only override per fact (`CHECKUP_PORT_3210`,
 * `CHECKUP_PORT_3211`) in the same spirit as CHECKUP_PG_PORT: the fact keeps its
 * contract name while the probe touches a port the suite chose. A run of the test
 * suite must not go red because the developer's own `pnpm dev` holds 3210, and it
 * must not bind the real port underneath that server either.
 */
for (const port of [3210, 3211]) {
  const override = (process.env[`CHECKUP_PORT_${port}`] ?? '').trim();
  const probed = override === '' ? port : Number(override);
  if (!Number.isInteger(probed) || probed < 0 || probed > 65535) {
    results.push(report(`port-${port}`, false, `cannot probe ${override} — not a usable TCP port`));
    continue;
  }
  const { ok, detail } = await bindable(probed);
  const where = probed === port ? `127.0.0.1:${port}` : `127.0.0.1:${probed} (probed for ${port})`;
  results.push(report(`port-${port}`, ok, `${where} ${detail}`));
}

const storageRoot = process.env['CHECKUP_STORAGE_ROOT'] ?? join(repoRoot, 'var', 'storage');
let storageDetail = `${storageRoot} exists and is writable`;
let storageOk = true;
try {
  if (!statSync(storageRoot).isDirectory()) throw new Error('not a directory');
  accessSync(storageRoot, constants.W_OK);
} catch (error) {
  storageOk = false;
  storageDetail = `${storageRoot} unusable (${error.code ?? error.message})`;
}
results.push(report('storage-root', storageOk, storageDetail));

// M0 needs no environment variables yet; the set grows with the increments that
// need it, and CHECKUP_REQUIRED_ENV lets a run simulate a larger set.
const required = (process.env['CHECKUP_REQUIRED_ENV'] ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '');
const missing = required.filter((name) => (process.env[name] ?? '') === '');
results.push(
  report(
    'env',
    missing.length === 0,
    missing.length === 0
      ? `${required.length} required variable(s) present`
      : `missing ${missing.join(', ')}`,
  ),
);

process.exit(summarise(results));
