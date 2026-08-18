# Vextrus

One app, one schema lane, zero codegen, verification in seconds, no cache that can lie.

## Toolchain

Pinned: Node 24 line (`.nvmrc`), pnpm 10 exactly (`packageManager`), TypeScript 6 strict
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

Each stage announces itself on a line of its own, `== stage <name> ==`. Fail-fast
ordering is observable only through those lines, so the marker is a shape nothing
else in the output prints: a `tsc` error inside `eslint.config.ts` must not read as
"the eslint stage ran".

Every verify stage that writes works inside one per-run directory beneath
`.next-verify` (`run-<runner pid>`), removed when the run ends. `next typegen` writes
this run's route types there and `next build` builds there, wiped first and again
afterwards, so the build is always cold, never collides with the dev server's
`.next`, and two verify runs against one worktree neither destroy each other's output
nor typecheck route types the other run is halfway through rewriting. `tsconfig.json`
names no run directory: a `run-*` glob would put every run's generated route types —
and any left behind by a run that was killed before it could clean up — into the input
of both `pnpm verify` and a bare `pnpm typecheck`, which is a cache that can lie (B-03).
Instead the tsc stage hands tsc a scratch config carrying this run's types directory
and nothing else, the run directory is removed in a `finally`, and every run first
sweeps the directories of runs whose process is gone.
For the same reason verify never writes `tsconfig.json`: `next build`/`next typegen`
rewrite the tsconfig they are handed, so they are handed a per-process
`tsconfig.verify-<pid>.json` that extends the real one and is deleted afterwards. A
command whose job is to report on the tree does not edit it — and cannot race another
run, or a developer's own edit, over a shared file.

Verify prints its total wall time, and notes when a full run exceeds the Q-01 local
budget of 60 s (`VERIFY_BUDGET_SECONDS` moves the note). It is a note, not a failure:
the exit code says whether the contract held, not how fast the machine is.

`CHECKUP_PG_PORT`, `CHECKUP_PORT_3210`, `CHECKUP_PORT_3211`, `CHECKUP_NODE_VERSION`,
`CHECKUP_PNPM_VERSION`, `CHECKUP_UV_VERSION`, `CHECKUP_STORAGE_ROOT` and
`CHECKUP_REQUIRED_ENV` exist so a failing machine can be simulated in a test without
touching the machine. They are passed per run, by the test that needs that particular
answer; none is set suite-wide. A blanket override would make the facts true by
construction — pnpm-pin comparing the pin to itself, uv-present green on a machine
with no uv, a port fact that probes port 0 and so can never find a busy one — and a
report that cannot fail is not a report.

The two pins are judged at different precisions, deliberately. `.nvmrc` reads `24`:
Node is pinned to the LTS **line**, so any 24.x satisfies node-pin and a patch
release landing on the machine does not turn the report red. pnpm is pinned
**exactly** by `packageManager` — corepack refuses anything else, so a looser
comparison would pass a machine that cannot install this lockfile.
