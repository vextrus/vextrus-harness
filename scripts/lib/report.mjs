/**
 * One line per machine fact: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`.
 *
 * Callers set `process.exitCode` and fall off the end rather than calling
 * `process.exit()`: stdout is a pipe here (checkup captures its facts, and the
 * acceptance suite captures checkup), and on POSIX a piped stdout is
 * asynchronous — `process.exit()` can drop writes that have not drained, which
 * would silently truncate the report the exit code is meant to explain.
 */
export function report(name, ok, detail) {
  process.stdout.write(`${ok ? 'ok' : 'FAIL'} ${name} — ${detail}\n`);
  return ok;
}

export const summarise = (results) => (results.every(Boolean) ? 0 : 1);
