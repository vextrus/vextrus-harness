/**
 * V-CHECKUP: the toolchain pins, compared against what this machine actually
 * runs. `CHECKUP_NODE_VERSION` / `CHECKUP_PNPM_VERSION` override the *actual*
 * side of the comparison so a mismatch can be simulated without touching the
 * machine.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const readRoot = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const stripV = (version) => version.trim().replace(/^v/, '');

function nodePin() {
  const pinned = stripV(readRoot('.nvmrc'));
  const actual = stripV(process.env['CHECKUP_NODE_VERSION'] ?? process.version);
  return {
    ok: actual === pinned,
    detail: `node ${actual} (.nvmrc pins ${pinned})`,
  };
}

function pnpmPin() {
  const packageManager = JSON.parse(readRoot('package.json')).packageManager ?? '';
  const pinned = packageManager.replace(/^pnpm@/, '');
  const override = process.env['CHECKUP_PNPM_VERSION'];
  let actual = override;
  if (actual === undefined) {
    const probe = spawnSync('pnpm', ['--version'], { encoding: 'utf8', cwd: ROOT });
    actual = (probe.stdout ?? '').trim();
  }
  if (actual === '') {
    return { ok: false, detail: `pnpm not runnable (packageManager pins ${pinned})` };
  }
  return {
    ok: stripV(actual) === stripV(pinned),
    detail: `pnpm ${stripV(actual)} (packageManager pins ${pinned})`,
  };
}

function uvPresent() {
  const probe = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) {
    return { ok: true, detail: (probe.stdout ?? '').trim() || 'uv present' };
  }
  return { ok: false, detail: 'uv not on PATH (needed by the cad lane)' };
}

export const checks = [
  { name: 'node-pin', check: nodePin },
  { name: 'pnpm-pin', check: pnpmPin },
  { name: 'uv-present', check: uvPresent },
];
