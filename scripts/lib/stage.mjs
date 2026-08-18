/**
 * Shared plumbing for the drop-in runners. Deliberately outside `verify.d/` and
 * `checkup.d/`, so it is never mistaken for a stage or a fact.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The distDir `pnpm verify` builds into; never the dev server's `.next`. */
export const VERIFY_DIST_DIR = '.next-verify';

/**
 * One verify run's scratch space beneath `.next-verify`.
 *
 * It has to be shared by the stages of a single run — `next typegen` writes the
 * route types that the tsc stage then typechecks — and unshared between runs:
 * two `pnpm verify` invocations against one worktree must not have run A
 * typechecking route types run B is halfway through rewriting. So the id comes
 * from the runner: `scripts/verify.mjs` stamps VERIFY_RUN_ID with its own pid
 * before spawning any stage. A stage run on its own (VERIFY_ONLY debugging, or
 * `node scripts/verify.d/<stage>.mjs`) falls back to its own pid, which is still
 * unique per run.
 *
 * `tsconfig.json` therefore includes a glob under `.next-verify/run-*`, not one
 * fixed directory, so whichever run wrote the types is the run that reads them.
 */
export const verifyRunDir = () =>
  `${VERIFY_DIST_DIR}/run-${process.env['VERIFY_RUN_ID'] ?? String(process.pid)}`;

/** `10-typegen.mjs` -> `typegen`: the number orders, the name is what gets printed. */
export const stepName = (file) => file.replace(/\.mjs$/, '').replace(/^\d+[-_]/, '');

/** Every `*.mjs` in the drop-in directory, in filename order. */
export function discoverSteps(directory) {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.mjs'))
    .sort()
    .map((file) => ({ file, name: stepName(file), path: join(directory, file) }));
}

/** Runs a drop-in step as its own process so any `.mjs` file works as a step. */
export function runStep(step, env = {}) {
  const result = spawnSync(process.execPath, [step.path], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** Runs a local binary from `node_modules/.bin`, inheriting stdio. */
export function runBin(binary, args, env = {}) {
  const bin = join(repoRoot, 'node_modules', '.bin', binary);
  const result = spawnSync(bin, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export const seconds = (startedAt) => ((Date.now() - startedAt) / 1000).toFixed(1);

/**
 * `next build`/`next typegen` append their distDir's type globs to the tsconfig
 * they are pointed at. The tree is the contract: a verify run reports on it, it
 * does not edit it.
 *
 * Snapshotting and restoring `tsconfig.json` was not enough. The file is shared
 * global state, so two concurrent verify runs — which the per-process distDirs
 * exist to allow — race on it: run B can snapshot the file mid-way through run
 * A's build and then write that mutated content back permanently. The same
 * window clobbers a developer's edit made while verify runs.
 *
 * So the file is never written at all. Next is pointed at a per-process scratch
 * tsconfig that `extends` the real one and lives beside it (same directory, so
 * every relative glob and path in it resolves identically); Next rewrites the
 * scratch, and it is deleted when the stage ends.
 */
export function withScratchTsconfig(run) {
  const real = join(repoRoot, 'tsconfig.json');
  const scratchName = `tsconfig.verify-${process.pid}.json`;
  const scratchPath = join(repoRoot, scratchName);
  const base = JSON.parse(readFileSync(real, 'utf8'));

  // `include`/`exclude` are carried over rather than inherited: a child tsconfig
  // that declares neither lets Next invent its own scope for the build.
  const scratch = { extends: './tsconfig.json' };
  if (base.include !== undefined) scratch.include = base.include;
  if (base.exclude !== undefined) scratch.exclude = base.exclude;

  writeFileSync(scratchPath, `${JSON.stringify(scratch, null, 2)}\n`);
  try {
    return run({ NEXT_TSCONFIG_PATH: scratchName });
  } finally {
    rmSync(scratchPath, { force: true });
  }
}
