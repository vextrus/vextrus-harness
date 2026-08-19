# Acceptance tests

- `tests/acceptance/*.spec.ts` — unit/contract acceptance. These are part of
  `pnpm test`, so `vitest.config.ts` must keep an include that matches
  `tests/**/*.spec.ts` (vitest's default include does).
- `tests/e2e/*.e2e.ts` — journey segments. They drive `pnpm verify` and
  `pnpm dev`, so they must **not** be part of `pnpm test`: running them inside
  the verify run's own vitest stage would re-enter `pnpm verify`. The `.e2e.ts`
  suffix keeps them out of the default include; run them with

      pnpm exec vitest run --config vitest.acceptance.config.ts

  (against a tree where `pnpm install` has already run).

## The database lane (V-DB)

- `tests/acceptance/db-lane-contract.spec.ts` — the statements about the tree
  (scripts, layout, the seam's import boundary). No database, so it belongs in
  `pnpm test`.
- `tests/e2e/db-lane.e2e.ts` — the live journey: `pnpm db:migrate`, the seam
  facts per discovered table, the role split, `pnpm test:db` and `pnpm db:drift`.
  It needs the scratch Postgres `checkup`'s `postgres-5544` fact probes, and it
  drives `pnpm verify`, so it is a journey segment rather than part of
  `pnpm test`. An unreachable database is a red journey, not a skipped one.
