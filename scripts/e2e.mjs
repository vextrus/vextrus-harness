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
import { spawn } from 'node:child_process';
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

/**
 * V-E2E: "Model calls use fixture transport." That is a fact about this lane,
 * not a request the ambient environment gets to make — so the lane states it for
 * itself before it starts anything, and every child inherits it from here rather
 * than from whatever was exported in the shell that ran `pnpm e2e`.
 */
const TRANSPORT = 'fixture';
const WORKER_READY = `e2e: worker ready (noop) transport=${TRANSPORT}`;
process.env.MODEL_TRANSPORT = TRANSPORT;

// ---------------------------------------------------------------- arguments

/**
 * The lane's own flags, with everything it does not recognise passed straight
 * through to Playwright — `--headed`, `--debug` and `-g` are useful and this
 * script has no business re-implementing them.
 */
function parseArgs(argv) {
  const parsed = {
    journey: undefined,
    journeyAsked: false,
    updateBaselines: false,
    reason: undefined,
    /** `{ '--reason': '--headed' }` — a flag-shaped token left where a value was expected. */
    refused: {},
    passthrough: [],
  };
  /**
   * A flag-shaped token: a dash followed by a letter or digit, and no spaces —
   * `--journey`, `-g`, `--headed`. A reason like `-- rebrand` is not one of
   * these, and neither is anything a person would plausibly type as a value, so
   * the guard below can be about flags rather than about the first character.
   */
  const flagShaped = (token) => /^-{1,2}[A-Za-z0-9][^\s]*$/.test(token);
  /**
   * The token after a flag is that flag's value unless it is itself a flag.
   * Taking `argv[i + 1]` unconditionally is how `--journey` (value forgotten)
   * becomes "no selection at all" and runs the whole suite, and how
   * `--reason --journey J-000` eats the selection — but refusing every token
   * that merely *starts* with a dash silently threw away legitimate values
   * (`--reason "-- rebrand"`). Flag-shaped tokens are refused, and `refused()`
   * below says so rather than reporting the value as missing.
   */
  const valueAt = (i) => {
    const next = argv[i + 1];
    return next === undefined || flagShaped(next) ? undefined : next;
  };
  /** The flag-shaped token that was not taken as `flag`'s value, if there was one. */
  const refusedAt = (i) => {
    const next = argv[i + 1];
    return next !== undefined && flagShaped(next) ? next : undefined;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--journey') {
      parsed.journeyAsked = true;
      parsed.journey = valueAt(i);
      parsed.refused['--journey'] = refusedAt(i);
      if (parsed.journey !== undefined) i += 1;
    } else if (arg.startsWith('--journey=')) {
      parsed.journeyAsked = true;
      parsed.journey = arg.slice('--journey='.length);
    } else if (arg === '--update-baselines') {
      parsed.updateBaselines = true;
    } else if (arg === '--reason') {
      parsed.reason = valueAt(i);
      parsed.refused['--reason'] = refusedAt(i);
      if (parsed.reason !== undefined) i += 1;
    } else if (arg.startsWith('--reason=')) {
      parsed.reason = arg.slice('--reason='.length);
    } else {
      parsed.passthrough.push(arg);
    }
  }
  // A selection that names nothing is a mistyped selection, and the whole point
  // of the exit-3 refusal is that a mistyped selection is loud: silently running
  // every journey is the opposite of what the caller typed.
  if (parsed.journeyAsked && (parsed.journey ?? '').trim() === '') parsed.journey = '';
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

/**
 * "You typed nothing" and "what you typed looked like a flag" are different
 * mistakes with different fixes, and a refusal that confuses them sends the
 * caller looking for a value they did in fact supply.
 */
const refusedValue = (flag) => {
  const token = args.refused[flag];
  return token === undefined
    ? ''
    : ` (\`${token}\` was read as a flag, not as the value — write \`${flag}=${token}\` to pass it)`;
};

if (args.updateBaselines && reason === '') {
  warn(
    'e2e: --update-baselines needs --reason "<why>" — a baseline rewritten without a recorded ' +
      `reason is a visual diff nobody reviewed (Q-06).${refusedValue('--reason')}`,
  );
  process.exit(2);
}

if (args.journeyAsked && args.journey === '') {
  warn(`e2e: --journey needs a journey id, e.g. --journey J-000${refusedValue('--journey')}`);
  process.exit(3);
}

if (args.journey !== undefined && !declaredJourneys().has(args.journey)) {
  warn(`e2e: no journey ${String(args.journey)}`);
  process.exit(3);
}

// -------------------------------------------------------------- child helpers

/** Everything this run started, taken down in reverse on the way out. */
const running = [];

/** True from the moment Playwright is handed `--update-snapshots`: the PNGs are being rewritten. */
let baselinesRewriting = false;

const forget = (child) => {
  const at = running.indexOf(child);
  if (at >= 0) running.splice(at, 1);
};

const gone = (child) => child.exitCode !== null || child.signalCode !== null;

/**
 * Signal the child's whole process group. `next start` is a shell shim in front
 * of node, so signalling the pid alone leaves the server running on 3211 and the
 * next run of the lane fails on a port it thinks it owns.
 */
function signalGroup(child, signal) {
  if (gone(child)) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already reaped between the check and the kill: nothing left to signal.
    }
  }
}

/** Waits for one child to be actually gone, forcing it after the grace period. */
function reap(child, graceMs) {
  if (gone(child)) return Promise.resolve();
  return new Promise((done) => {
    const forced = setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs);
    child.once('exit', () => {
      clearTimeout(forced);
      done();
    });
  });
}

/**
 * Stop everything this run started — and *wait*. `pnpm e2e` returning has to
 * mean 3211 is free and no worker is left behind, or a second run races the
 * first one's leftovers.
 */
async function stopAll(graceMs = 10_000) {
  const children = running.splice(0, running.length).reverse();
  for (const child of children) signalGroup(child, 'SIGTERM');
  await Promise.all(children.map((child) => reap(child, graceMs)));
}

// A lane that is interrupted takes its children with it: the worker and the web
// server are the lane's, and orphaning them is how a machine ends up with a
// server on 3211 nobody started.
let interrupting = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => {
    if (interrupting) process.exit(code);
    interrupting = true;
    warn(`e2e: ${signal} — stopping web and worker`);
    if (baselinesRewriting) recordBaselineUpdate();
    void stopAll(5_000).then(() => process.exit(code));
  });
}

/**
 * Q-06's recorded reason, written once per run.
 *
 * Playwright rewrites the baseline PNGs as it goes, so by the time the run's
 * status is known the tree has already been mutated: conditioning the record on
 * a green run loses the reason in exactly the case a reviewer most needs it — a
 * rewrite that then went red on a later journey, on the axe check, or on a ^C.
 * AC-06 says an update run "rewrites baselines ... and appends one line"; it
 * does not say "if it passes".
 */
let baselineUpdateRecorded = false;
function recordBaselineUpdate() {
  if (baselineUpdateRecorded) return;
  baselineUpdateRecorded = true;
  const scope = args.journey === undefined ? 'all journeys' : args.journey;
  appendFileSync(UPDATES_LOG, `- ${new Date().toISOString()} — ${scope} — ${reason}\n`);
}

const localBin = (name) => join(repoRoot, 'node_modules', '.bin', name);

/**
 * A foreground step, inheriting stdio so its output lands in the transcript in
 * order. Awaited rather than `spawnSync`: a synchronous spawn blocks the event
 * loop, and a lane that cannot run its own signal handlers during a five-minute
 * build is a lane that orphans its children when somebody presses ^C.
 */
function run(command, commandArgs, extraEnv = {}) {
  return new Promise((done, failed) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    running.push(child);
    child.on('error', (error) => {
      forget(child);
      failed(error);
    });
    child.on('exit', (code, signal) => {
      forget(child);
      done(signal === null ? (code ?? 1) : 1);
    });
  });
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
  child.on('exit', () => forget(child));

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
 * Wait for a started child to be ready — and give up early if it dies first: a
 * worker that exited at once is a red run in two seconds, not in thirty.
 */
async function waitFor(started, probe, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    if (started !== undefined && gone(started.child)) {
      throw new Error(`e2e: ${what} exited before it was ready`);
    }
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

const scratchEnv = { VDB_PG_DATABASE: SCRATCH_DB, MODEL_TRANSPORT: TRANSPORT };

let status = 1;
try {
  // 1. Build — once, and before anything perishable is set up.
  say('e2e: build');
  const built = await run(localBin('next'), ['build'], scratchEnv);
  if (built !== 0) throw new Error(`e2e: next build failed (${String(built)})`);

  // 2. Scratch database: dropped, created here, migrated by the append-only lane.
  await recreateScratchDatabase();
  const migrated = await run(process.execPath, [join(repoRoot, 'scripts', 'db-migrate.mjs')], scratchEnv);
  if (migrated !== 0) throw new Error(`e2e: db:migrate failed (${String(migrated)})`);
  say(`e2e: scratch db ${SCRATCH_DB} ready`);

  // 3. Seed.
  say('e2e: seed');
  const seeded = await run(process.execPath, [join(repoRoot, 'scripts', 'seed.mjs')], scratchEnv);
  if (seeded !== 0) throw new Error(`e2e: seed failed (${String(seeded)})`);

  // 4. Web, on the lane's own port so a running `pnpm dev` on 3210 is undisturbed.
  const baseUrl = `http://127.0.0.1:${String(WEB_PORT)}`;
  const web = start(localBin('next'), ['start', '-p', String(WEB_PORT)], {
    ...scratchEnv,
    PORT: String(WEB_PORT),
  });
  await waitFor(web, () => respondsOn(`${baseUrl}/`), 120_000, `the app on ${String(WEB_PORT)}`);
  say(`e2e: web ready on ${String(WEB_PORT)}`);

  // 5. Worker. It prints its own ready line; the lane waits for that exact line
  //    rather than assuming, so the stage order is a fact about a process. The
  //    transport is not in question here: the worker entry pins fixture whatever
  //    the environment asks for (V-E2E, and the comment at the top of
  //    tests/e2e/harness/worker.mjs), so the only ready line it can print is
  //    this one — waiting for it *is* the transport check.
  const worker = start(process.execPath, [join(repoRoot, 'tests', 'e2e', 'harness', 'worker.mjs')], {
    ...scratchEnv,
    MODEL_TRANSPORT: TRANSPORT,
  });
  await waitFor(
    worker,
    () => Promise.resolve(worker.output().includes(WORKER_READY)),
    30_000,
    'the worker ready line',
  );

  // 6. The journeys.
  const playwrightArgs = ['test'];
  if (args.journey === undefined) {
    // Breakers are journeys that must fail; excluded by default, or CI is red forever.
    playwrightArgs.push('--grep-invert', '@breaker');
  } else {
    // The lookahead keeps `@J-SELF` from also selecting `@J-SELF-AXE-FAIL`.
    playwrightArgs.push('--grep', `@${args.journey}(?![-\\w])`);
  }
  if (args.updateBaselines) {
    playwrightArgs.push('--update-snapshots');
    // Armed *before* the run, not after: the rewrite starts with the first
    // checkpoint, so anything that happens from here on is a run that touched
    // the committed baselines and owes UPDATES.md a line.
    baselinesRewriting = true;
  }
  playwrightArgs.push(...args.passthrough);

  status = await run(localBin('playwright'), playwrightArgs, {
    ...scratchEnv,
    E2E_BASE_URL: baseUrl,
  });
} catch (error) {
  warn(error.message);
  status = status === 0 ? 1 : status;
} finally {
  // 7. Q-06's recorded reason — for the green run, the red one, and the throw.
  if (baselinesRewriting) recordBaselineUpdate();
  // Awaited: the lane owns web and worker, and `pnpm e2e` returning has to mean
  // they are gone — not that they have been asked to go.
  await stopAll();
}

// Never `process.exit()` while stdout may still be draining into a caller's pipe.
process.exitCode = status;
