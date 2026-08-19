# Pending acceptance — m0-01b rule surface

Acceptance written ahead of the leaf that owns the surface it judges. Files here
end in `*.pending.ts`, which is outside `vitest.config.ts`'s include
(test and spec suffixes only), so they do not gate any other increment —
but they are still type-checked and linted, so they cannot rot.

- `q08-suite-modifier-smuggling.pending.ts` — Q-08 / B-03 / SEAM-TENANT: five
  RuleTester cases proving `vextrus/no-forbidden-escapes` fires on a suite
  modifier taken off a barrel-imported or dynamically-imported opener. Relocated
  out of `tests/acceptance/` by arbitration on m0-02-db-lane: the assertions are
  correct and may not be deleted or diluted, but the surface they judge
  (`src/lint/rules/no-forbidden-escapes.ts`) is m0-01b's, not the db lane's.

When m0-01b runs, move the file back to `tests/acceptance/` as
`q08-suite-modifier-smuggling.spec.ts` (drop one `../` from the rule import) and
turn it green.
