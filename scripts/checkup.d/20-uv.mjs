/**
 * V-CHECKUP: the cad lane's two pins — the uv the branch was built with, and
 * the Python line the project runs on.
 *
 * `10-node-pnpm.mjs` already answers "is uv on PATH at all"; this asks the
 * sharper question the lane depends on, which is whether it is *the* uv. The
 * two pins are read differently on purpose:
 *
 *   - uv is exact. It resolves and locks, so a different uv is a different
 *     `uv.lock`, and a lockfile that changes because of the tool that read it
 *     is the drift this repo refuses everywhere else.
 *   - Python is a LINE. `cad/.python-version` pins `3.13`, and any 3.13.x
 *     patch satisfies it — a machine report must not go red because a security
 *     patch landed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/stage.mjs';
import { report, summarise } from '../lib/report.mjs';

const cad = join(repoRoot, 'cad');

const results = [];

/** An exported-but-empty override is the ordinary shell accident: no override. */
const override = (name) => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? undefined : value;
};

const pin = (file) => readFileSync(join(cad, file), 'utf8').trim();

/** `uv 0.12.5 (abc 2026-01-01)` / `3.13.15` -> `0.12.5` / `3.13.15`. */
const version = (raw) => /(\d+\.\d+(?:\.\d+)?)/.exec(String(raw ?? ''))?.[1] ?? '';

const line = (raw) => version(raw).split('.').slice(0, 2).join('.');

// CHECKUP_UV_VERSION is the actual-version override, the same test-only lever
// CHECKUP_NODE_VERSION and CHECKUP_PNPM_VERSION are: it lets a suite assert the
// shape of this report without asserting what is installed on the machine.
const uvPin = pin('.uv-version');
const uvActual = version(
  override('CHECKUP_UV_VERSION') ??
    (spawnSync('uv', ['--version'], { encoding: 'utf8' }).stdout ?? ''),
);
results.push(
  report(
    'uv-pin',
    uvActual !== '' && uvActual === version(uvPin),
    `cad/.uv-version pins ${uvPin}, running ${uvActual || 'unknown'}`,
  ),
);

// The interpreter as the project would get it, not as PATH happens to have it:
// `uv run --project cad` is what every step of the cad lane goes through. On a
// machine that has never synced this materialises the environment first, which
// is slow exactly once and is the machine report doing its job.
const pythonPin = pin('.python-version');
const pythonActual = version(
  override('CHECKUP_CAD_PYTHON_VERSION') ??
    (spawnSync(
      'uv',
      ['run', '--project', cad, 'python', '-c', 'import sys; print(sys.version.split()[0])'],
      { cwd: repoRoot, encoding: 'utf8' },
    ).stdout ?? ''),
);
results.push(
  report(
    'cad-python-pin',
    pythonActual !== '' && line(pythonActual) === line(pythonPin),
    `cad/.python-version pins ${pythonPin}, running ${pythonActual || 'unknown'}`,
  ),
);

// Not `process.exit()`: see scripts/lib/report.mjs — a piped stdout drains
// asynchronously, and a truncated report is worse than a slow one.
process.exitCode = summarise(results);
