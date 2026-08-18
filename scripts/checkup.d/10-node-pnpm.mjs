/** Toolchain pins: the versions this repo is allowed to be built with. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/stage.mjs';
import { report, summarise } from '../lib/report.mjs';

const results = [];

const pinnedNode = readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
const actualNode = (process.env['CHECKUP_NODE_VERSION'] ?? process.version).replace(/^v/, '');
results.push(
  report(
    'node-pin',
    // The pin is the pin: `.nvmrc` and `engines.node` both name one exact
    // version, so "close enough" is a report that lies about the toolchain.
    actualNode === pinnedNode,
    `.nvmrc pins ${pinnedNode}, running ${actualNode}`,
  ),
);

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const pinnedPnpm = String(pkg.packageManager ?? '').replace(/^pnpm@/, '').split('+')[0];
const override = process.env['CHECKUP_PNPM_VERSION'];
const actualPnpm =
  override ?? (spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).stdout ?? '').trim();
results.push(
  report(
    'pnpm-pin',
    actualPnpm === pinnedPnpm,
    `packageManager pins ${pinnedPnpm}, running ${actualPnpm || 'unknown'}`,
  ),
);

// CHECKUP_UV_VERSION is the test-only actual-version override, exactly like
// CHECKUP_NODE_VERSION / CHECKUP_PNPM_VERSION: it lets a suite assert the shape
// of the report without asserting what is installed on the machine running it.
const uvOverride = process.env['CHECKUP_UV_VERSION'];
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
