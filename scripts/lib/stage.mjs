/**
 * Shared plumbing for the drop-in runners. Deliberately outside `verify.d/` and
 * `checkup.d/`, so it is never mistaken for a stage or a fact.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
 * `tsconfig.json` names no run directory at all. A glob over `run-*` would put
 * *every* run's route types — including any left behind by a run that was killed
 * before it could clean up — into the input set of both `pnpm verify` and a bare
 * `pnpm typecheck`, which is a cache that can lie (B-03). Instead the tsc stage
 * hands tsc a scratch config that adds this run's types directory and nothing
 * else, and `pruneStaleRunDirs` sweeps the leftovers of runs that are gone.
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

/**
 * The one line a stage announces itself with.
 *
 * Fail-fast ordering is observable only through these lines, so the line has to
 * be impossible to confuse with anything a tool prints: a `tsc` error inside a
 * file called `eslint-something.ts`, or `next build` saying "Creating an
 * optimized production build", must not read as "that stage ran". So the name is
 * wrapped in a token nothing else in the run emits, and the line is anchored at
 * both ends.
 */
export const stageMarker = (name) => `== stage ${name} ==`;

const MARKER = /^==\s+stage\s+([a-z0-9-]+)\s+==$/;

/** The stage a line announces, or undefined if the line announces nothing. */
export const announcedStage = (line) => MARKER.exec(line.trim())?.[1];

/**
 * Index of the line where `stage` announced itself, or -1. Anchored to the
 * marker: prose that merely mentions the name is not that stage running.
 */
export function stageLineIndex(output, stage) {
  const lines = Array.isArray(output) ? output : String(output).split('\n');
  return lines.findIndex((line) => announcedStage(String(line)) === stage);
}

/** Whether `stage` announced itself in this output. */
export const ranStage = (output, stage) => stageLineIndex(output, stage) >= 0;

/**
 * Runs a drop-in step as its own process so any `.mjs` file works as a step.
 *
 * The step's own output is captured rather than inherited, and the caller
 * decides what to do with it. A green run then prints nothing but its stage
 * lines and its wall time — the transcript is the contract and nothing else —
 * and a red one prints the failing tool's diagnostics under that stage's line,
 * where they belong. It also keeps a passing stage's chatter from being read as
 * a later stage running: `next typegen` is not allowed to make `build` look like
 * it happened.
 */
export function runStep(step, env = {}) {
  const result = spawnSync(process.execPath, [step.path], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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

/** Where a finished run leaves its timings, beside the distDir it built into. */
export const VERIFY_TIMING_FILE = `${VERIFY_DIST_DIR}/last-run.json`;

/**
 * The Q-01 clock: `V-VERIFY green, ≤ 60 s local, no cache`.
 *
 * Read as a judgement rather than as a note in passing, so it is a thing that can
 * be wrong: `budget` is what the run was measured against, `exceeded` is whether
 * it blew it, and `enforced` is whether that ends the run non-zero. The default
 * reports without failing — a green tree must not go red because the box was
 * cold, and AC-01 is about the five stages, not the wall clock — but
 * VERIFY_BUDGET_ENFORCE=1 makes the budget a hard edge for a caller (CI, a later
 * increment) that wants one. Either way the number is written down: a run that
 * walks the budget past 60 s leaves the evidence in the transcript and in
 * `VERIFY_TIMING_FILE`, instead of being noticed by nobody.
 *
 * `budget` of 0, empty or unparseable means "do not judge" — a caller that wants
 * no clock at all says so, and a typo cannot silently invent a budget.
 */
export function budgetVerdict(totalSeconds, env = process.env) {
  const budget = Number(env['VERIFY_BUDGET_SECONDS'] ?? '60');
  if (!Number.isFinite(budget) || budget <= 0) {
    return { budget: undefined, exceeded: false, enforced: false };
  }
  const total = Number(totalSeconds);
  const exceeded = Number.isFinite(total) && total > budget;
  const enforce = !['', '0', 'false'].includes(env['VERIFY_BUDGET_ENFORCE'] ?? '');
  return { budget, exceeded, enforced: exceeded && enforce };
}

/**
 * Writes the run's timings where the next reader can find them. Best-effort: a
 * report on the tree does not fail because it could not write its own footnote.
 */
export function recordRunTiming(record) {
  const path = join(repoRoot, VERIFY_TIMING_FILE);
  try {
    mkdirSync(join(repoRoot, VERIFY_DIST_DIR), { recursive: true });
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // Unwritable scratch is not a verification result.
  }
  return path;
}

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
export function withScratchTsconfig(run, extraIncludes = []) {
  const real = join(repoRoot, 'tsconfig.json');
  const scratchName = `tsconfig.verify-${process.pid}.json`;
  const scratchPath = join(repoRoot, scratchName);
  const base = JSON.parse(readFileSync(real, 'utf8'));

  // `include`/`exclude` are carried over rather than inherited: a child tsconfig
  // that declares neither lets Next invent its own scope for the build.
  const scratch = { extends: './tsconfig.json' };
  if (base.include !== undefined || extraIncludes.length > 0) {
    scratch.include = [...(base.include ?? []), ...extraIncludes];
  }
  if (base.exclude !== undefined) scratch.exclude = base.exclude;

  writeFileSync(scratchPath, `${JSON.stringify(scratch, null, 2)}\n`);
  try {
    return run({ NEXT_TSCONFIG_PATH: scratchName }, scratchName);
  } finally {
    rmSync(scratchPath, { force: true });
  }
}

/**
 * Scratch directories outlive their run whenever the run is killed — Ctrl-C, a CI
 * timeout, SIGKILL — and no `finally` can help there. So every run sweeps first:
 * a `run-<pid>` directory whose process is gone belongs to nobody, and route
 * types nobody owns are exactly the stale input B-03 forbids.
 */
export function pruneStaleRunDirs() {
  const root = join(repoRoot, VERIFY_DIST_DIR);
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const mine = verifyRunDir().slice(VERIFY_DIST_DIR.length + 1);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === mine) continue;
    const pid = Number(/^run-(\d+)$/.exec(entry.name)?.[1]);
    if (!Number.isInteger(pid)) continue;
    try {
      // Signal 0 tests for the process without touching it.
      process.kill(pid, 0);
      continue; // still running: that run owns its directory.
    } catch (error) {
      if (error.code === 'EPERM') continue; // alive, just not ours to signal.
    }
    rmSync(join(root, entry.name), { recursive: true, force: true });
  }
}
