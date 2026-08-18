/** Toolchain pins: the versions this repo is allowed to be built with. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/stage.mjs';
import { report, summarise } from '../lib/report.mjs';

const results = [];

/** `v24.19.0` / `24.19.0` / `pnpm@10.34.5+sha512.abc` -> `24.19.0` / `10.34.5`. */
const version = (raw) =>
  String(raw ?? '')
    .trim()
    .replace(/^(?:pnpm|node)@/, '')
    .replace(/^v/, '')
    .split('+')[0]
    .trim();

const major = (raw) => version(raw).split('.')[0] ?? '';

// An exported-but-empty override is the ordinary shell accident: it means "no
// override", not "this machine runs no Node at all".
const override = (name) => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? undefined : value;
};

// The Node pin is a major pin: the Bible pins "Node 24 LTS", and `.nvmrc` names
// the release line — nvm resolves `24.19.0` and `24` alike to a Node 24. So the
// fact is "this machine runs the pinned line", not "this machine runs the exact
// patch its author happened to have": patch releases inside a line are security
// fixes nobody should have to opt out of the toolchain to take. The detail line
// prints the pin and the running version in full, so drift is still visible.
const nodePin = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim();
const runningNode = override('CHECKUP_NODE_VERSION') ?? process.version;
const nodeOk = major(nodePin) !== '' && major(runningNode) === major(nodePin);
results.push(
  report(
    'node-pin',
    nodeOk,
    `.nvmrc pins ${version(nodePin)} (Node ${major(nodePin)} line), running ${String(runningNode).trim()}`,
  ),
);

// The pnpm pin is exact: `packageManager` is corepack's contract and corepack
// itself refuses anything but the named version, so anything looser here would
// pass a machine that cannot install this lockfile.
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const pnpmPin = version(pkg.packageManager);
const runningPnpm =
  override('CHECKUP_PNPM_VERSION') ??
  (spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).stdout ?? '').trim();
// `pnpm checkup` leaves its own version in the user agent, so the fact still has
// an answer on a machine where spawning pnpm is not available.
const agentPnpm = /\bpnpm\/(\d+\.\d+\.\d+)/.exec(process.env['npm_config_user_agent'] ?? '')?.[1];
const pnpmActual = version(runningPnpm) || version(agentPnpm);
results.push(
  report(
    'pnpm-pin',
    pnpmActual !== '' && pnpmActual === pnpmPin,
    `packageManager pins pnpm@${pnpmPin}, running ${pnpmActual || 'unknown'}`,
  ),
);

// CHECKUP_UV_VERSION is the test-only actual-version override, exactly like
// CHECKUP_NODE_VERSION / CHECKUP_PNPM_VERSION: it lets a suite assert the shape
// of the report without asserting what is installed on the machine running it.
const uvOverride = override('CHECKUP_UV_VERSION');
const uv = uvOverride === undefined ? spawnSync('uv', ['--version'], { encoding: 'utf8' }) : undefined;
const uvVersion = (uvOverride ?? uv?.stdout ?? '').trim();
results.push(
  report(
    'uv-present',
    uvOverride !== undefined || uv?.status === 0,
    uvVersion === '' ? 'not on PATH' : uvVersion,
  ),
);

process.exit(summarise(results));
