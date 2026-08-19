/**
 * B-05 / V-VERIFY: `pnpm verify`'s exit code is a statement about the tree, so
 * nothing inside the suite it runs may depend on the machine's spare capacity.
 *
 * The settled reading is explicit:
 *
 *   > the acceptance suite proves the tool via overrides and must not depend on
 *   > the real 3210/3211 being free
 *
 * `checkup-port-independence.spec.ts` was written to abolish exactly that
 * dependency — and abolishes it by *binding* 3210 and 3211 itself, to simulate
 * `pnpm dev`. A held port cannot be held twice: on a machine where `pnpm dev` is
 * already running (checkpoint `scaffold-home`, the previous milestone's journey)
 * the bind throws EADDRINUSE, the three tests go red, and `pnpm verify` fails on
 * a tree with nothing wrong with it. Two concurrent verify runs collide the same
 * way. That is the mutual exclusion the file's own header names, reintroduced
 * one line lower down.
 *
 * A simulation does not need the contract's own port numbers: the per-fact
 * `CHECKUP_PORT_3210` / `CHECKUP_PORT_3211` overrides exist so a suite can point
 * a fact at a port it minted and holds. So the rule is mechanical rather than
 * prose — no acceptance spec listens on a contract port.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { repoRoot } from './support/cli';

const ACCEPTANCE = join(repoRoot(), 'tests', 'acceptance');

/** The ports the product itself owns: `pnpm dev`/`pnpm start`, and its sibling. */
const CONTRACT_PORTS = [3210, 3211] as const;

const specs = (): string[] =>
  readdirSync(ACCEPTANCE)
    .filter((entry) => entry.endsWith('.spec.ts'))
    .sort();

/**
 * A `listen(...)` call whose port argument is a contract port literal — the one
 * shape that makes a spec's result depend on whether the machine's 3210 is free.
 * A spec that *names* 3210 to assert on a fact's name is untouched.
 */
const bindsPort = (source: string, port: number): boolean =>
  new RegExp(String.raw`\.listen\s*\(\s*${port}\b`).test(source) ||
  new RegExp(String.raw`\bhold\s*\(\s*${port}\s*\)`).test(source) ||
  new RegExp(String.raw`\blisten\w*\s*\(\s*${port}\s*[,)]`).test(source);

describe('the acceptance suite does not compete with the running app for a port', () => {
  for (const port of CONTRACT_PORTS) {
    test(`no acceptance spec listens on ${port}`, () => {
      const offenders = specs().filter((spec) =>
        bindsPort(readFileSync(join(ACCEPTANCE, spec), 'utf8'), port),
      );
      expect(
        offenders,
        `binding ${port} makes pnpm verify red whenever pnpm dev holds it — ` +
          `hold an ephemeral port and point the fact at it with CHECKUP_PORT_${port}`,
      ).toEqual([]);
    });
  }

  test('the rule is not vacuous — there are acceptance specs to judge', () => {
    expect(specs().length).toBeGreaterThan(0);
  });
});
