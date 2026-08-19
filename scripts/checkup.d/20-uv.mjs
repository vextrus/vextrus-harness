/**
 * V-CHECKUP's half of the cad toolchain: the two pins the Python lane is built
 * with. `10-node-pnpm.mjs` already answers whether uv is on PATH at all; this
 * fact answers the harder question — whether it is *the* uv, and whether the
 * interpreter behind `cad/` is the one the project pins.
 *
 * The two pins are read differently on purpose. uv is exact: a resolver is
 * allowed to change what it resolves between patch releases, so a lockfile
 * committed under one uv is only reproducible under that uv. The Python pin is a
 * LINE — `cad/.python-version` says `3.13`, and 3.13.x is 3.13 — because a
 * patched CPython landing on a machine is not a machine that has gone wrong.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { report, summarise } from '../lib/report.mjs';
import { repoRoot } from '../lib/stage.mjs';

const results = [];

const cad = join(repoRoot, 'cad');

/** `uv 0.12.5 (x86_64-unknown-linux-gnu)` / `v3.13.15` -> `0.12.5` / `3.13.15`. */
const version = (raw) => /(\d+\.\d+(?:\.\d+)?)/.exec(String(raw ?? ''))?.[1] ?? '';

/** `3.13.15` -> `3.13`. */
const line = (raw) => version(raw).split('.').slice(0, 2).join('.');

// An exported-but-empty override is the ordinary shell accident: it means "no
// override", not "this machine runs no uv at all".
const override = (name) => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? undefined : value;
};

const pin = (file) => readFileSync(join(cad, file), 'utf8').trim();

/** A tool's own answer for what it is, or '' if asking failed. */
function ask(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

// uv-pin: exact. `cad/.uv-version` records the uv this branch's `uv.lock` was
// resolved with, so a mismatch is a warning that a `uv sync` here may not
// reproduce the tree it reproduced there.
const uvPin = version(pin('.uv-version'));
const uvActual = version(override('CHECKUP_UV_VERSION') ?? ask('uv', ['--version']));
results.push(
  report(
    'uv-pin',
    uvActual !== '' && uvActual === uvPin,
    `cad/.uv-version pins ${uvPin}, running ${uvActual || 'unknown'}`,
  ),
);

// cad-python-pin: the interpreter uv actually runs the project on, asked for by
// running it. On a cold machine this is the call that materialises `cad/.venv` —
// acceptable here, because checkup is the machine report and a report that
// refuses to look is not one.
const pythonPin = line(pin('.python-version'));
const pythonActual = line(
  override('CHECKUP_CAD_PYTHON_VERSION') ??
    ask('uv', ['run', '--project', cad, 'python', '-c', 'import platform;print(platform.python_version())'], {
      cwd: repoRoot,
    }),
);
results.push(
  report(
    'cad-python-pin',
    pythonActual !== '' && pythonActual === pythonPin,
    `cad/.python-version pins ${pythonPin}, cad runs ${pythonActual || 'unknown'}`,
  ),
);

// Not `process.exit()`: see scripts/lib/report.mjs — a piped stdout drains
// asynchronously, and a truncated report is worse than a slow one.
process.exitCode = summarise(results);
