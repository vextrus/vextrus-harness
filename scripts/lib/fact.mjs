/**
 * Shared plumbing for the checkup facts. It lives outside `scripts/checkup.d/`
 * so the runner, which treats every file in that directory as a fact group,
 * never executes it on its own.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;

/** One line per fact: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`. */
export function report(passed, name, detail) {
  console.log(`${passed ? 'ok' : 'FAIL'} ${name} — ${detail}`);
  if (!passed) failures += 1;
}

/** Every fact in the group is reported before the group's code is decided. */
export function finish() {
  process.exit(failures > 0 ? 1 : 0);
}
