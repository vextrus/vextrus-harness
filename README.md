# Vextrus

One app, one schema lane, verification in seconds, no cache that can lie (B-03).

## Toolchain

Pinned: Node 24 (`.nvmrc`), pnpm 10 (`packageManager`), TypeScript 6 strict with
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, Next 16 (App Router,
Turbopack), React 19, ESLint 10 flat config, Vitest 4. Every dependency is an
exact version; `.npmrc` sets `save-exact=true` so it stays that way.

```bash
pnpm install --frozen-lockfile
pnpm checkup   # what this machine can and cannot do
pnpm dev       # http://127.0.0.1:3210
pnpm verify    # the whole contract, in one exit code
```

## Verification

`pnpm verify` runs `scripts/verify.d/*.mjs` in filename order, fail-fast, no
cache, printing each stage name and the total wall time. The stages this
increment ships are typegen, tsc, eslint, vitest, build; the build is cold into
its own `.next-verify` distDir so it can never be warmed by `pnpm dev`. A later
increment adds a stage by adding a file — never by editing the runner.

`pnpm checkup` runs `scripts/checkup.d/*.mjs` and reports every machine fact by
name, one line each, `ok <fact> — detail` or `FAIL <fact> — detail`. It is not
fail-fast: one bad fact does not hide the rest, but it does make the exit code
non-zero. Facts: `node-pin`, `pnpm-pin`, `uv-present`, `postgres-5544`,
`port-3210`, `port-3211`, `storage-root`, `env`.

Failure is simulated through env overrides, never by breaking the machine:
`CHECKUP_PG_PORT`, `CHECKUP_NODE_VERSION`, `CHECKUP_PNPM_VERSION`,
`CHECKUP_STORAGE_ROOT`.

`postgres-5544` expects a Postgres listening on port 5544; the database lane
arrives in a later increment, but checkup already tells you the truth about it.

## Lint rules

The repo's own guardrails live in `src/lint/rules/*.ts`. Each module exports
`{ rule, files, severity }`; `src/lint/loader.ts` discovers them and
`eslint.config.ts` mounts them under the `vextrus` namespace without naming any
of them. Every rule ships a fixture test in `src/lint/__tests__/` proving it
fires and does not over-fire (Q-01).
