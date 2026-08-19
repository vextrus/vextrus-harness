#!/usr/bin/env node
/**
 * V-E2E, the lane itself: build once, recreate the scratch database, seed it,
 * start web and worker, run the journeys, take everything down again.
 *
 * The stage lines it prints are part of the contract, in this order:
 *
 *   e2e: build
 *   e2e: scratch db vextrus_e2e_scratch ready
 *   e2e: seed
 *   e2e: web ready on 3211
 *   e2e: worker ready (noop) transport=fixture
 *
 * They are the lane's own account of what it did, and reading them in order is
 * how somebody with a red run finds out how far it got. The build appears once
 * per invocation because it happens once: a lane that rebuilds per journey is a
 * lane nobody runs locally.
 *
 * Refusals come first, before a compiler or a socket is touched:
 *
 *   --update-baselines without --reason  -> exit 2 (Q-06: an approved update has
 *                                          a recorded reason, or it is a diff
 *                                          nobody read)
 *   --journey J-999 (unknown)            -> exit 3
 *
 * The scratch database lifecycle lives here rather than in scripts/db-migrate.mjs
 * because the migration lane is append-only by contract and must never be able
 * to drop anything (layout-db). This script drops and creates; db-migrate then
 * migrates whatever it is pointed at.
 *
 *   pnpm e2e
 *   pnpm e2e --journey J-000
 *   pnpm e2e --update-baselines --reason "new nav bar"
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCRATCH_DB = 'vextrus_e2e_scratch';
const WEB_PORT = 3211;
const JOURNEY_DIRS = [join(repoRoot, 'tests', 'e2e', 'harness'), join(repoRoot, 'tests', 'e2e', 'journeys')];
const UPDATES_LOG = join(repoRoot, 'tests', 'e2e', 'baselines', 'UPDATES.md');

const say = (line) => process.stdout.write(`${line}\n`);
const warn = (line) => process.stderr.write(`${line}\n`);

/** An exported-but-empty override falls back to the default (the m0-02 convention). */
const env = (name, fallback) => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

const bootstrapUrl = () => env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');

// ---------------------------------------------------------------- arguments

/**
 * The lane's own flags, with everything it does not recognise passed straight
 * through to Playwright — `--headed`, `--debug` and `-g` are useful and this
 * script has no business re-implementing them.
 */
function parseArgs(argv) {
  const parsed = { journey: undefined, updateBaselines: false, reason: undefined, passthrough: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--journey') {
      parsed.journey = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--journey=')) {
      parsed.journey = arg.slice('--journey='.length);
    } else if (arg === '--update-baselines') {
      parsed.updateBaselines = true;
    } else if (arg === '--reason') {
      parsed.reason = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--reason=')) {
      parsed.reason = arg.slice('--reason='.length);
    } else {
      parsed.passthrough.push(arg);
    }
  }
  return parsed;
}

/** Every journey id declared in the tree, read off the `journey('J-…')` calls. */
function declaredJourneys() {
  const ids = new Set();
  for (const dir of JOURNEY_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir, { recursive: true })) {
      const name = String(file);
      if (!name.endsWith('.journey.ts')) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      for (const match of source.matchAll(/journey\(\s*'([^']+)'/g)) ids.add(match[1]);
      for (const match of source.matchAll(/journey\(\s*"([^"]+)"/g)) ids.add(match[1]);
    }
  }
  return ids;
}

const args = parseArgs(process.argv.slice(2));
const reason = (args.reason ?? '').trim();

if (args.updateBaselines && reason === '') {
  warn(
    'e2e: --update-baselines needs --reason "<why>" — a baseline rewritten without a recorded ' +
      'reason is a visual diff nobody reviewed (Q-06).',
  );
  process.exit(2);
}

if (args.journey !== undefined && !declaredJourneys().has(args.journey)) {
  warn(`e2e: no journey ${String(args.journey)}`);
  process.exit(3);
}

// -------------------------------------------------------------- child helpers

/** Everything this run started, taken down in reverse on the way out. */
const running = [];

const alive = (child) => child.exitCode === null && child.signalCode === null;

/** Signal every live child's whole process group, youngest first. */
function signalAll(signal) {
  for (const child of [...running].reverse()) {
    if (!alive(child)) continue;
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
}

function stopAll() {
  signalAll('SIGTERM');
  running.length = 0;
}

/**
 * The lane owns the processes it starts, however it ends.
 *
 * Web and worker are started detached, in their own process groups, so that a
 * SIGTERM reaches whatever they spawn in turn (`next start` is a supervisor).
 * The price of detaching is that nothing else will ever reap them: an operator
 * pressing ^C, or a CI step timing out, would otherwise leave a worker holding
 * the scratch database and `next start` holding 3211 — and the next run would
 * fail on a port that nobody can explain. So the lane takes the signal itself,
 * takes its children down, and only then goes.
 */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopAll();
    // 128 + signal number, the shell's convention for "ended by this signal".
    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143);
  });
}

// A last net under the throw paths: `process.kill` is synchronous, so this still
// runs when something exits the lane without reaching the `finally` below.
process.on('exit', stopAll);

const localBin = (name) => join(repoRoot, 'node_modules', '.bin', name);

/** A foreground step, inheriting stdio so its output lands in the transcript in order. */
function run(command, commandArgs, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return result.status ?? 1;
}

/**
 * A long-lived child in its own process group (so a SIGTERM reaches whatever it
 * spawned), with its output forwarded and watched for a readiness line.
 */
function start(command, commandArgs, extraEnv = {}) {
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  running.push(child);

  let seen = '';
  const forward = (stream, sink) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      seen += chunk;
      sink.write(chunk);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  return { child, output: () => seen };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Take web and worker down and wait until they are actually gone.
 *
 * The waiting is the point: `pnpm e2e` returning is the caller's signal that the
 * lane is over, and a caller who then asks "is a worker still running? is 3211
 * free?" must not be racing a SIGTERM that has not been delivered yet. Anything
 * still up after the grace period gets SIGKILL — a hung child may not hold the
 * lane's exit code hostage.
 */
async function shutdown() {
  signalAll('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (running.some(alive) && Date.now() < deadline) await sleep(50);
  signalAll('SIGKILL');
  while (running.some(alive) && Date.now() < deadline + 2_000) await sleep(50);
  running.length = 0;
}

async function waitFor(probe, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await sleep(200);
  }
  throw new Error(`e2e: timed out after ${String(timeoutMs)}ms waiting for ${what}`);
}

// --------------------------------------------------------------- lane stages

/**
 * Drop and create the scratch database.
 *
 * Dropped rather than truncated: the lane's promise is that a journey starts
 * from a known world, and a database that survives a run is a database that
 * accumulates whatever a red journey left behind. `WITH (FORCE)` because a
 * previous run's `next start` may still hold a connection.
 */
async function recreateScratchDatabase() {
  const client = new Client({ connectionString: bootstrapUrl() });
  await client.connect();
  try {
    await client.query(`drop database if exists "${SCRATCH_DB}" with (force)`);
    await client.query(`create database "${SCRATCH_DB}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function respondsOn(url) {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * The environment every stage of the lane runs in.
 *
 * `MODEL_TRANSPORT=fixture` is V-E2E's ("model calls use fixture transport") and
 * it is set here rather than inherited: a lane that ran against a live model
 * because somebody had exported something in their shell would be a lane whose
 * green means nothing. An ambient value loses to this one — deliberately.
 */
const scratchEnv = { VDB_PG_DATABASE: SCRATCH_DB, MODEL_TRANSPORT: 'fixture' };

// The same for anything started without `scratchEnv` (a passthrough tool, a
// hook): in this process tree the transport is fixture, whatever the caller said.
process.env.MODEL_TRANSPORT = 'fixture';

let status = 1;
try {
  // 1. Build — once, and before anything perishable is set up.
  say('e2e: build');
  const built = run(localBin('next'), ['build'], scratchEnv);
  if (built !== 0) throw new Error(`e2e: next build failed (${String(built)})`);

  // 2. Scratch database: dropped, created here, migrated by the append-only lane.
  await recreateScratchDatabase();
  const migrated = run(process.execPath, [join(repoRoot, 'scripts', 'db-migrate.mjs')], scratchEnv);
  if (migrated !== 0) throw new Error(`e2e: db:migrate failed (${String(migrated)})`);
  say(`e2e: scratch db ${SCRATCH_DB} ready`);

  // 3. Seed.
  say('e2e: seed');
  const seeded = run(process.execPath, [join(repoRoot, 'scripts', 'seed.mjs')], scratchEnv);
  if (seeded !== 0) throw new Error(`e2e: seed failed (${String(seeded)})`);

  // 4. Web, on the lane's own port so a running `pnpm dev` on 3210 is undisturbed.
  const baseUrl = `http://127.0.0.1:${String(WEB_PORT)}`;
  start(localBin('next'), ['start', '-p', String(WEB_PORT)], { ...scratchEnv, PORT: String(WEB_PORT) });
  await waitFor(() => respondsOn(`${baseUrl}/`), 120_000, `the app on ${String(WEB_PORT)}`);
  say(`e2e: web ready on ${String(WEB_PORT)}`);

  // 5. Worker. It prints its own ready line; the lane waits for it rather than
  //    assuming, so the stage order is a fact about processes, not about sleeps.
  const worker = start(process.execPath, [join(repoRoot, 'tests', 'e2e', 'harness', 'worker.mjs')], {
    ...scratchEnv,
  });
  await waitFor(() => {
    // A worker that died is never going to print its line; say so now rather
    // than in thirty seconds' time.
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      throw new Error(`e2e: the worker exited before it was ready (${String(worker.child.exitCode)})`);
    }
    return Promise.resolve(worker.output().includes('e2e: worker ready (noop)'));
  }, 30_000, 'the worker ready line');

  // 6. The journeys.
  const playwrightArgs = ['test'];
  if (args.journey === undefined) {
    // Breakers are journeys that must fail; excluded by default, or CI is red forever.
    playwrightArgs.push('--grep-invert', '@breaker');
  } else {
    // The lookahead keeps `@J-SELF` from also selecting `@J-SELF-AXE-FAIL`.
    playwrightArgs.push('--grep', `@${args.journey}(?![-\\w])`);
  }
  if (args.updateBaselines) playwrightArgs.push('--update-snapshots');
  playwrightArgs.push(...args.passthrough);

  status = run(localBin('playwright'), playwrightArgs, { ...scratchEnv, E2E_BASE_URL: baseUrl });

  // 7. Q-06's recorded reason, written only for a run that actually rewrote PNGs.
  if (args.updateBaselines && status === 0) {
    const scope = args.journey === undefined ? 'all journeys' : args.journey;
    appendFileSync(UPDATES_LOG, `- ${new Date().toISOString()} — ${scope} — ${reason}\n`);
  }
} catch (error) {
  warn(error.message);
  status = status === 0 ? 1 : status;
} finally {
  await shutdown();
}

// Never `process.exit()` while stdout may still be draining into a caller's pipe.
process.exitCode = status;
