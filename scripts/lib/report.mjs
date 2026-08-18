/** One line per machine fact: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`. */
export function report(name, ok, detail) {
  process.stdout.write(`${ok ? 'ok' : 'FAIL'} ${name} — ${detail}\n`);
  return ok;
}

export const summarise = (results) => (results.every(Boolean) ? 0 : 1);
