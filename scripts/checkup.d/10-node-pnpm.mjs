import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Toolchain pins: the versions the repo declares must be the versions running. */

function pinnedNode(repoRoot) {
  return readFileSync(join(repoRoot, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
}

function pinnedPnpm(repoRoot) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  return String(pkg.packageManager ?? '').replace(/^pnpm@/, '').split('+')[0];
}

function actualPnpm() {
  const override = process.env.CHECKUP_PNPM_VERSION;
  if (override !== undefined && override.length > 0) return override;
  const agent = process.env.npm_config_user_agent ?? '';
  const fromAgent = /pnpm\/(\d+\.\d+\.\d+)/.exec(agent);
  if (fromAgent !== null) return fromAgent[1];
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  return (result.stdout ?? '').trim();
}

export const facts = [
  {
    name: 'node-pin',
    check: ({ repoRoot }) => {
      const pin = pinnedNode(repoRoot);
      const actual = (process.env.CHECKUP_NODE_VERSION ?? process.version).replace(/^v/, '');
      return {
        ok: actual === pin,
        detail: actual === pin ? `v${actual} matches .nvmrc` : `v${actual} running, .nvmrc pins v${pin}`,
      };
    },
  },
  {
    name: 'pnpm-pin',
    check: ({ repoRoot }) => {
      const pin = pinnedPnpm(repoRoot);
      const actual = actualPnpm();
      return {
        ok: actual === pin && pin.length > 0,
        detail:
          actual === pin
            ? `${actual} matches packageManager`
            : `${actual.length > 0 ? actual : 'unknown'} running, packageManager pins ${pin}`,
      };
    },
  },
  {
    name: 'uv-present',
    check: () => {
      const result = spawnSync('uv', ['--version'], { encoding: 'utf8' });
      const line = (result.stdout ?? '').trim();
      const ok = result.status === 0 && line.length > 0;
      return { ok, detail: ok ? line : 'uv not on PATH (needed by the cad lane)' };
    },
  },
];
