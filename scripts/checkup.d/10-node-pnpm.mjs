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
    actualNode.split('.')[0] === pinnedNode.split('.')[0],
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

const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' });
const uvVersion = (uv.stdout ?? '').trim();
results.push(
  report('uv-present', uv.status === 0, uvVersion === '' ? 'not on PATH' : uvVersion),
);

process.exit(summarise(results));
