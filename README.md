# Vextrus

One app, one schema lane, zero codegen, verification in seconds, no cache that can lie.

## Toolchain (pinned, exact)

| Tool | Pin | Where |
| --- | --- | --- |
| Node | 24 LTS | `.nvmrc` |
| pnpm | 10, `save-exact` | `packageManager`, `.npmrc` |
| TypeScript | 6, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | `tsconfig.json` |
| Next | 16, App Router / Turbopack | `next.config.ts` |
| React | 19 | `package.json` |
| ESLint | 10, flat config + typescript-eslint | `eslint.config.ts` |
| Vitest | 4 | `vitest.config.ts` |

Every dependency is written as an exact version — no `^`, no `~`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next dev server on port **3210** |
| `pnpm verify` | The whole contract, as an exit code (see below) |
| `pnpm checkup` | The machine's report — run it at session start |
| `pnpm test` | `vitest run` over `src/**` |
| `pnpm lint` | `eslint .` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Production build |
| `pnpm e2e --journey <J>` | Journey specs under `tests/e2e` |
| `pnpm test:db` | Database lane (no schema yet in this increment) |

## `pnpm verify`

`scripts/verify.mjs` runs every file in `scripts/verify.d/` **in filename order**,
fail-fast, and prints the total wall time. Today that is:

```
typegen → tsc → eslint → vitest → build
```

Each stage announces itself on its own line before it runs, so the transcript
alone shows where a run stopped. The build stage compiles cold into its own
`.next-verify` distDir so it can never collide with — or be flattered by — a
running `pnpm dev`.

**A new stage is a new file.** Drop `scripts/verify.d/50-whatever.mjs` in; it
needs a `name` and a `run()` that returns a status (or throws). Nothing shared
gets edited.

`VERIFY_ONLY=<prefix>` runs a single stage while debugging — it matches either
the numeric prefix (`VERIFY_ONLY=30`) or the stage name (`VERIFY_ONLY=eslint`).

## `pnpm checkup`

`scripts/checkup.mjs` runs every file in `scripts/checkup.d/` and reports each
machine fact on its own line:

```
ok   <fact-name> — detail
FAIL <fact-name> — detail
```

Unlike verify, checkup is **not** fail-fast: a report that stops at the first
bad fact hides the other seven. It exits non-zero if any fact failed, having
printed them all. Facts today: `node-pin`, `pnpm-pin`, `uv-present`,
`postgres-5544`, `port-3210`, `port-3211`, `storage-root`, `env`.

Ports are probed by really binding and really closing; Postgres is a raw TCP
connect, so no database driver enters the toolchain. Failures are simulated
through env overrides rather than by touching the machine:
`CHECKUP_PG_PORT`, `CHECKUP_NODE_VERSION`, `CHECKUP_PNPM_VERSION`,
`CHECKUP_STORAGE_ROOT`.

## Guardrail lint rules

`eslint.config.ts` never names a rule. `src/lint/loader.ts` discovers
`src/lint/rules/*.ts`; each module exports `{ rule, files, severity }` and is
registered under the `vextrus` plugin namespace with the globs and severity it
declares for itself. **A new guardrail is a new file plus its fixture test** in
`src/lint/__tests__/`.

The first rule, `vextrus/no-forbidden-escapes`, makes the Q-08 escapes errors:
unspecified type annotations, the two compiler-suppression comments, every
lint-disable comment variant, and exclusive/skipped test modifiers. Inline
config is switched off repo-wide, so a suppression comment cannot switch off
the guardrail that forbids suppression comments.

Fixtures for that rule build every forbidden token by concatenation. Written
literally they would trip the repo's own `eslint .` and confuse the test runner.
