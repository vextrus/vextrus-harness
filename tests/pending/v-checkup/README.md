# Pending acceptance — the checkup lane (V-CHECKUP)

Acceptance for `pnpm checkup` that was gating the wrong leaf. Files here end in
`*.pending.ts`, which is outside `vitest.config.ts`'s include (test and spec
suffixes only), so they do not gate any other increment — but they are still
type-checked and linted, so they cannot rot.

- `checkup-cli.pending.ts` — V-CHECKUP / AC-02 / AC-03: `pnpm checkup` names all
  eight facts with an `ok` marker and exits 0; each fact is one line with a
  detail; a failing fact does not stop the rest.
- `checkup-port-independence.pending.ts` — the same acceptance re-run while
  something holds the contract ports 3210 and 3211, proving the checkup
  acceptance judges the tree rather than the machine's spare capacity.

Relocated out of `tests/acceptance/` by arbitration on m0-02-db-lane. The
behavioural assertions are correct and may not be deleted or diluted, but the
surface they judge (`scripts/checkup.mjs`, `scripts/checkup.d/`) is the checkup
leaf's, not the db lane's: no clause the db lane quotes names a checkup CLI, the
contract ports or an eight-fact report, and the db lane's commit touches neither
the checkup runners nor these files.

The same arbitration rejected mandating the `CHECKUP_PORT_3210` /
`CHECKUP_PORT_3211` overrides as a *test* requirement — those names appear in no
spec. Port independence is an observable behaviour (a per-fact override, an
ephemeral port, or no listener at all), so the two assertions that prescribed the
override mechanism were dropped; what remains asserts only the behaviour.

When the checkup leaf runs, move both files back to `tests/acceptance/` under
their `*.spec.ts` names (drop one `../` from the `support/cli` imports) and turn
them green. They travel together: `checkup-port-independence` runs
`tests/acceptance/checkup-cli.spec.ts` by path, which is that file's home again
once restored.
