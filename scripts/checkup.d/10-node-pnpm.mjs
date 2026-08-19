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

// The Node pin is a LINE, not a patch: the Bible pins "Node 24 LTS via .nvmrc"
// and AC-07 contrasts it with pnpm ("pins pnpm 10 to an exact version"). Any
// 24.x satisfies it, so an LTS patch landing on the machine does not turn this
// machine-health report red. The detail names the pin as written and the full
// running version, so a failure says which two numbers disagreed.
const nodePin = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim();
const runningNode = override('CHECKUP_NODE_VERSION') ?? process.version;
const pinnedNode = version(nodePin);
const actualNode = version(runningNode);
const nodeOk = major(pinnedNode) !== '' && major(actualNode) === major(pinnedNode);
results.push(report('node-pin', nodeOk, `.nvmrc pins ${pinnedNode}, running ${actualNode}`));

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

// Not `process.exit()`: see scripts/lib/report.mjs — a piped stdout drains
// asynchronously, and a truncated report is worse than a slow one.
process.exitCode = summarise(results);
