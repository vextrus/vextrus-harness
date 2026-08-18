/** Toolchain pins: the machine must run exactly what the repository declares. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, finish, report } from '../lib/fact.mjs';

const clean = (value) => value.trim().replace(/^v/, '');

const nodePin = clean(readFileSync(path.join(REPO_ROOT, '.nvmrc'), 'utf8'));
const nodeActual = clean(process.env.CHECKUP_NODE_VERSION ?? process.version);
report(
  nodeActual === nodePin,
  'node-pin',
  `node ${nodeActual} vs .nvmrc pin ${nodePin}`,
);

const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const pnpmPin = String(pkg.packageManager ?? '').replace(/^pnpm@/, '').replace(/\+.*$/, '');

function detectPnpm() {
  const override = process.env.CHECKUP_PNPM_VERSION;
  if (override !== undefined && override !== '') return clean(override);
  const agent = /pnpm\/(\d+\.\d+\.\d+)/.exec(process.env.npm_config_user_agent ?? '');
  if (agent !== null && agent[1] !== undefined) return agent[1];
  const probe = spawnSync('pnpm', ['--version'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return clean(probe.stdout ?? '');
}

const pnpmActual = detectPnpm();
report(
  pnpmActual === pnpmPin && pnpmPin !== '',
  'pnpm-pin',
  `pnpm ${pnpmActual || 'not found'} vs packageManager pin ${pnpmPin || 'missing'}`,
);

const uv = spawnSync(process.env.CHECKUP_UV_BIN ?? 'uv', ['--version'], { encoding: 'utf8' });
const uvVersion = (uv.stdout ?? '').trim();
report(
  (uv.status ?? 1) === 0,
  'uv-present',
  uvVersion !== '' ? uvVersion : 'uv is not on PATH',
);

finish();
