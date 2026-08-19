/**
 * One line per machine fact: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`.
 *
 * Callers set `process.exitCode` and fall off the end rather than calling
 * `process.exit()`: stdout is a pipe here (checkup captures its facts, and the
 * acceptance suite captures checkup), and on POSIX a piped stdout is
 * asynchronous — `process.exit()` can drop writes that have not drained, which
 * would silently truncate the report the exit code is meant to explain.
 */
/**
 * A fact is also read on its own — `node scripts/checkup.d/40-ports-env.mjs |
 * head -1` is the obvious way to look at one probe while debugging a machine —
 * and that reader closes the pipe on the *fact*, not on the runner. A fact that
 * answers a closed pipe with an unhandled EPIPE stack trace replaces a machine
 * report with a crash: the probe was fine, the reader simply walked away. So the
 * guard lives here, beside the write, where every fact that reports gets it.
 */
const ignoreBrokenPipe = (stream) => {
  stream.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
  });
};
ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

export function report(name, ok, detail) {
  process.stdout.write(`${ok ? 'ok' : 'FAIL'} ${name} — ${detail}\n`);
  return ok;
}

export const summarise = (results) => (results.every(Boolean) ? 0 : 1);
