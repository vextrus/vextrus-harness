# Vextrus

One app, one schema lane, zero codegen — verification in seconds, and no cache
that can lie.

## Toolchain

Pinned, exactly: Node (`.nvmrc`), pnpm (`packageManager`), TypeScript strict
with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, Next (App
Router, Turbopack), React, ESLint flat config, Vitest. `.npmrc` sets
`save-exact=true`, so every dependency in `package.json` is an exact version.

Entry points: `pnpm checkup` (what this machine looks like), `pnpm verify` (the
whole contract in one exit code), `pnpm dev` (http://127.0.0.1:3210).

## `pnpm verify`

`scripts/verify.mjs` runs every file in `scripts/verify.d` in filename order,
fail-fast, printing each stage name as it starts and the total wall time at the
end. A new stage is a new file — no shared file is edited. `VERIFY_ONLY=<prefix>`
runs one stage while debugging. The production compile is cold and lands in its
own `.next-verify` distDir, so it can never collide with the dev server.

## `pnpm checkup`

`scripts/checkup.mjs` runs every file in `scripts/checkup.d` and reports each
machine fact by name — `ok <fact> — detail` or `FAIL <fact> — detail`. It is
deliberately not fail-fast: a failing fact never hides the others, and the exit
code is non-zero if any fact failed. `CHECKUP_*` environment variables redirect
individual probes so failures can be simulated without touching the machine.

## Lint guardrails

`eslint.config.ts` names no rule: `src/lint/loader.ts` discovers every module in
its rules directory, each exporting `{ rule, files, severity }`, and registers
it under the `vextrus` namespace. Every rule ships fixture tests proving it
fires and that it does not fire on innocent code.
