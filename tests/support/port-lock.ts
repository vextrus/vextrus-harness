// The dev-server journey (port 3210) and the checkup port facts (3210/3211)
// cannot run at the same time, and vitest parallelises files. A cross-file
// advisory lock keeps them from lying to each other.
import { closeSync, openSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_PATH = join(tmpdir(), 'vextrus-m0-01-ports.lock');
const STALE_MS = 300_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function tryAcquire(): boolean {
  try {
    closeSync(openSync(LOCK_PATH, 'wx'));
    return true;
  } catch {
    try {
      if (Date.now() - statSync(LOCK_PATH).mtimeMs > STALE_MS) {
        rmSync(LOCK_PATH, { force: true });
      }
    } catch {
      // lock vanished under us; the next attempt will win it
    }
    return false;
  }
}

export async function withPortLock<T>(body: () => Promise<T>): Promise<T> {
  while (!tryAcquire()) {
    await sleep(250);
  }
  try {
    return await body();
  } finally {
    rmSync(LOCK_PATH, { force: true });
  }
}
