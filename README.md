# Vextrus

One app, one schema lane, zero codegen, verification in seconds, no cache that can lie.

## Toolchain

Pinned, exactly: Node 24 (`.nvmrc`), pnpm 10 (`packageManager`), TypeScript 6 strict
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Next 16 (App Router,
Turbopack), React 19, ESLint 10 flat config, Vitest 4. `.npmrc` sets `save-exact=true`,
so every dependency in `package.json` is a single version, never a range.

```sh
pnpm install --frozen-lockfile
pnpm checkup   # what this machine is
pnpm dev       # http://localhost:3210
pnpm verify    # the whole contract, in one exit code
```

## The two entry points

`pnpm verify` runs every stage in `scripts/verify.d/` in filename order, fail-fast,
and prints the total wall time. `pnpm checkup` runs every fact in `scripts/checkup.d/`,
reports all of them — it is deliberately *not* fail-fast — and exits non-zero if any
failed.

Both are extended by dropping in a file. Nothing in `scripts/verify.mjs`,
`scripts/checkup.mjs` or `eslint.config.ts` names an individual stage, fact or rule,
so a later increment never has to edit a shared file.

- a verify stage: `scripts/verify.d/<NN>-<name>.mjs`; its exit code is the stage's
  verdict. `VERIFY_ONLY=<prefix>` runs one stage while debugging.
- a checkup fact: `scripts/checkup.d/<NN>-<name>.mjs`; print
  `ok <fact-name> — detail` or `FAIL <fact-name> — detail`, exit non-zero if any
  fact of that file failed.
- a lint rule: `src/lint/rules/<name>.ts` exporting `{ rule, files, severity }`,
  plus a fixture test in `src/lint/__tests__/` proving it fires and does not
  over-fire. It is registered as `vextrus/<name>`.

`next build` under verify goes into its own `.next-verify`, wiped first, so it is
always cold and never collides with the dev server's `.next`.

`CHECKUP_PG_PORT`, `CHECKUP_NODE_VERSION`, `CHECKUP_PNPM_VERSION`,
`CHECKUP_STORAGE_ROOT` and `CHECKUP_REQUIRED_ENV` exist so a failing machine can be
simulated in a test without touching the machine.
