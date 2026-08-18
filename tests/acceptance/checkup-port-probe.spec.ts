/**
 * V-CHECKUP / B-03 ("no cache that can lie") — a fact may only report `ok` when
 * it actually proved something.
 *
 * `scripts/checkup.d/40-ports-env.mjs` accepts any integer `0 <= n <= 65535` as a
 * port-probe override, and binding port 0 asks the kernel for *any* free
 * ephemeral port — it succeeds unconditionally, on every machine, whatever the
 * state of 3210/3211. So `CHECKUP_PORT_3210=0 pnpm checkup` prints
 * `ok port-3210 — ... bindable` and exits 0 having tested nothing.
 *
 * Its sibling probe already draws this line: `scripts/checkup.d/30-postgres.mjs`
 * requires `port > 0` and reports `FAIL postgres-5544 — cannot probe ... not a
 * usable TCP port` for `CHECKUP_PG_PORT=0`. The port facts must reject 0 the same
 * way, so an override that cannot answer the question is a failed fact rather
 * than a green one.
 */
import { describe, expect, test } from 'vitest';

import { runCli } from './support/cli';

const factLine = (fact: string): RegExp => new RegExp(`^(ok|FAIL)\\s+${fact}\\b.*$`, 'm');

describe('checkup port probes reject a port that cannot be probed', () => {
  test.each(['port-3210', 'port-3211'])(
    '%s is not reported ok when its override is port 0',
    (fact) => {
      const port = fact.slice('port-'.length);
      const result = runCli('node', ['scripts/checkup.d/40-ports-env.mjs'], {
        [`CHECKUP_PORT_${port}`]: '0',
      });

      const line = factLine(fact).exec(result.stdout)?.[0] ?? '';
      expect(line, `${fact} must be reported`).not.toBe('');
      expect(line, 'binding port 0 always succeeds, so it proves nothing').toMatch(/^FAIL/);
      expect(line).toMatch(/not a usable TCP port/);
    },
  );

  test('the postgres probe already rejects port 0, so the port facts must agree', () => {
    const result = runCli('node', ['scripts/checkup.d/30-postgres.mjs'], {
      CHECKUP_PG_PORT: '0',
    });

    expect(result.stdout).toMatch(/^FAIL\s+postgres-5544\b.*not a usable TCP port/m);
  });
});
