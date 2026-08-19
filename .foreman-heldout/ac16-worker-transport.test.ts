/**
 * AC-16: the worker entry is a no-op that pins the lane's fixture transport.
 *
 * Amended after arbitration (INT-VE2E-fixture-pin): V-E2E's "Model calls use
 * fixture transport." is an unconditional invariant, and the arbiter chose the
 * pin-and-carry-on mechanism over refusal — whatever MODEL_TRANSPORT says, the
 * worker announces `transport=fixture`, comes up, and exits 0 when the lane
 * that started it asks it to stop. Signals: SIGTERM and SIGINT only; no clause
 * mentions SIGHUP, so a worker that dies on it is not failed here.
 *
 * The fixture/unset/empty cases already hold today and stand as named
 * regression guards; the live and anything-else cases are what the pin adds.
 */
import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, test } from 'vitest';

import { ensureBrowsers, hasLine, lane, repoRoot } from './support';

const READY = 'e2e: worker ready (noop) transport=fixture';

interface WorkerRun {
  readonly stdout: string;
  readonly aliveBeforeSignal: boolean;
  readonly exitCode: number | null;
}

/** Starts the worker under one MODEL_TRANSPORT setting, then asks it to stop. */
async function runWorker(
  transport: string | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
): Promise<WorkerRun> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== 'MODEL_TRANSPORT') env[key] = value;
  }
  if (transport !== undefined) env['MODEL_TRANSPORT'] = transport;

  const child = spawn(process.execPath, ['tests/e2e/harness/worker.mjs'], {
    cwd: repoRoot(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stdout += chunk;
  });

  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !stdout.includes('worker ready') && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // A worker that waits for its stop signal is still there a moment after it said so.
  await new Promise((resolve) => setTimeout(resolve, 750));
  const aliveBeforeSignal = child.exitCode === null && child.signalCode === null;

  child.kill(signal);
  const exitCode = await Promise.race([
    exited,
    new Promise<number | null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);
  child.kill('SIGKILL');
  return { stdout, aliveBeforeSignal, exitCode };
}

/** The invariant, whatever the caller asked for. */
function expectFixtureWorker(run: WorkerRun, what: string): void {
  expect(
    run.stdout.split('\n').map((line) => line.trim()),
    `${what}: the worker did not print its ready line:\n${run.stdout}`,
  ).toContain(READY);
  // Every readiness announcement names fixture — a warning that quotes the value
  // the caller asked for is the arbiter's chosen mechanism, not a violation.
  const readyLines = run.stdout.split('\n').filter((line) => line.includes('worker ready'));
  expect(
    readyLines.every((line) => line.includes('transport=fixture')),
    `${what}: the worker announced a transport other than fixture:\n${run.stdout}`,
  ).toBe(true);
  expect(run.aliveBeforeSignal, `${what}: the worker exited on its own instead of waiting`).toBe(
    true,
  );
}

describe('AC-16 the worker entry pins the fixture transport', () => {
  test('MODEL_TRANSPORT=fixture: announces fixture, waits, exits 0 on SIGTERM', async () => {
    const run = await runWorker('fixture');
    expectFixtureWorker(run, 'MODEL_TRANSPORT=fixture');
    expect(run.exitCode, 'the worker did not exit 0 on SIGTERM').toBe(0);
  }, 120_000);

  test('MODEL_TRANSPORT unset: still announces fixture and exits 0 on SIGTERM', async () => {
    const run = await runWorker(undefined);
    expectFixtureWorker(run, 'MODEL_TRANSPORT unset');
    expect(run.exitCode, 'the worker did not exit 0 on SIGTERM').toBe(0);
  }, 120_000);

  test('MODEL_TRANSPORT empty: still announces fixture and exits 0 on SIGINT', async () => {
    const run = await runWorker('', 'SIGINT');
    expectFixtureWorker(run, 'MODEL_TRANSPORT=""');
    expect(run.exitCode, 'the worker did not exit 0 on SIGINT').toBe(0);
  }, 120_000);

  test('MODEL_TRANSPORT=live: the invariant wins — fixture is announced, the worker still comes up', async () => {
    const run = await runWorker('live');
    expectFixtureWorker(run, 'MODEL_TRANSPORT=live');
    expect(run.exitCode, 'the worker did not exit 0 on SIGTERM').toBe(0);
  }, 120_000);

  test('MODEL_TRANSPORT=anything-else: fixture is announced and the worker exits 0 on SIGINT', async () => {
    const run = await runWorker('anthropic-api', 'SIGINT');
    expectFixtureWorker(run, 'MODEL_TRANSPORT=anthropic-api');
    expect(run.exitCode, 'the worker did not exit 0 on SIGINT').toBe(0);
  }, 120_000);
});

describe('AC-16 the lane gives its children the fixture transport', () => {
  beforeAll(() => {
    ensureBrowsers();
  });

  test('the worker reports transport=fixture even when the caller set nothing', () => {
    const result = lane(['--journey', 'J-SELF'], { MODEL_TRANSPORT: undefined });

    expect(result.status, `pnpm e2e --journey J-SELF failed:\n${result.output}`).toBe(0);
    expect(
      hasLine(result.output, READY),
      `the lane did not set MODEL_TRANSPORT=fixture for its children:\n${result.output}`,
    ).toBe(true);
  });
});
