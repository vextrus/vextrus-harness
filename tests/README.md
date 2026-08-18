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
