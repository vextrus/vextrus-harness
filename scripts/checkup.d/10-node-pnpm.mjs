/**
 * V-CHECKUP facts: the toolchain pins, plus uv (the Python lane's runner).
 *
 * The *actual* versions can be overridden (CHECKUP_NODE_VERSION /
 * CHECKUP_PNPM_VERSION) so a failing pin can be simulated in CI without
 * touching the machine.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const majorOf = (version) => /^v?(\d+)/.exec(version)?.[1] ?? null;

async function nodePin() {
  const pinned = readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8').trim();
  const actual = process.env.CHECKUP_NODE_VERSION ?? process.version;
  const ok = majorOf(actual) !== null && majorOf(actual) === majorOf(pinned);
  return { name: 'node-pin', ok, detail: `node ${actual} against .nvmrc ${pinned}` };
}

async function pnpmPin() {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const pinned = String(pkg.packageManager ?? '').replace(/^pnpm@/, '').replace(/\+.*$/, '');
  let actual = process.env.CHECKUP_PNPM_VERSION ?? null;
  if (actual === null) {
    const agent = /pnpm\/([\w.-]+)/.exec(process.env.npm_config_user_agent ?? '');
    actual = agent?.[1] ?? null;
  }
  if (actual === null) {
    try {
      actual = (await run('pnpm', ['--version'], { timeout: 30_000 })).stdout.trim();
    } catch (error) {
      return { name: 'pnpm-pin', ok: false, detail: `pnpm not runnable: ${String(error)}` };
    }
  }
  return {
    name: 'pnpm-pin',
    ok: actual === pinned,
    detail: `pnpm ${actual} against packageManager pin ${pinned}`,
  };
}

async function uvPresent() {
  try {
    const { stdout } = await run('uv', ['--version'], { timeout: 30_000 });
    return { name: 'uv-present', ok: true, detail: stdout.trim() || 'uv on PATH' };
  } catch {
    return { name: 'uv-present', ok: false, detail: 'uv is not on PATH (the cad lane needs it)' };
  }
}

export async function check() {
  return [await nodePin(), await pnpmPin(), await uvPresent()];
}
