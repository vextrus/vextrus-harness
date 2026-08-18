# Vextrus

One app, one schema lane, zero codegen — boring, mainstream, strongly typed (B-03).

## Toolchain (pinned, exactly)

| Tool | Pin | Where |
| --- | --- | --- |
| Node | 24.19.0 | `.nvmrc` |
| pnpm | 10.34.5 | `package.json` `packageManager` |
| TypeScript | 6.0.3 | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Next.js | 16.3.1 | App Router, Turbopack |
| React | 19.2.8 | |
| ESLint | 10.8.1 | flat config, `noInlineConfig` |
| Vitest | 4.1.10 | |

`.npmrc` sets `save-exact=true`; every dependency is an exact version.

## The two entry points

```
pnpm verify    # V-VERIFY — the whole contract in one exit code
pnpm checkup   # V-CHECKUP — the machine's report, run at session start
```

`pnpm verify` runs `scripts/verify.d/*.mjs` in filename order, fail-fast, and
prints each stage name and the total wall time. A new stage is a new numbered
file in that directory — the runner is never edited. `VERIFY_ONLY=<prefix>`
runs a single stage while debugging.

`pnpm checkup` runs `scripts/checkup.d/*.mjs` and reports every fact as
`ok <fact> — detail` or `FAIL <fact> — detail`. It is deliberately *not*
fail-fast: a broken machine is described completely, and the exit code is
non-zero if any fact failed. Facts today: `node-pin`, `pnpm-pin`, `uv-present`,
`postgres-5544`, `port-3210`, `port-3211`, `storage-root`, `env`.

Health can be simulated without touching the machine, via `CHECKUP_PG_PORT`,
`CHECKUP_NODE_VERSION`, `CHECKUP_PNPM_VERSION` and `CHECKUP_STORAGE_ROOT`.

## Everything else

```
pnpm dev                    # Next dev server on port 3210
pnpm build                  # production build
pnpm lint                   # eslint .
pnpm typecheck              # tsc --noEmit
pnpm test                   # vitest run (whole tree)
pnpm e2e --journey J-000    # the journey lane
pnpm test:db                # the database lane (nothing to check at M0)
```

## Guardrails

Custom lint rules live in `src/lint/rules/`, one file per rule, each exporting
`{ rule, files, severity }`. `src/lint/loader.ts` discovers them by directory
scan and `eslint.config.ts` registers them under the `vextrus` namespace — so a
new guardrail is a new file plus its fixture test in `src/lint/__tests__/`, and
never an edit to the shared config. Inline directives carry no authority in this
repo (`noInlineConfig`): a check cannot be switched off locally.
