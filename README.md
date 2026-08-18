# Vextrus

One app, one schema lane, boring and strongly typed (B-03).

## Toolchain

Pinned, exactly: Node 24 (`.nvmrc`), pnpm 10 (`packageManager`, with `save-exact=true`),
TypeScript 6 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
Next 16 (App Router, Turbopack), React 19, ESLint 10 flat config, Vitest 4.

```bash
pnpm install --frozen-lockfile
```

## The two entry points

| Command | What it does |
| --- | --- |
| `pnpm verify` | V-VERIFY: runs `scripts/verify.d/*.mjs` in filename order, fail-fast; the exit code is the whole contract and the total wall time is printed. `VERIFY_ONLY=<prefix>` runs a single stage while debugging. |
| `pnpm checkup` | V-CHECKUP: runs `scripts/checkup.d/*.mjs` and reports every machine fact as `ok <fact> — detail` / `FAIL <fact> — detail`. Never fail-fast; non-zero exit if any fact failed. |

Adding a stage or a fact is adding a file — no shared file is edited. `next build` runs
cold into its own `distDir` (`.next-verify`, wiped first), so `pnpm dev`'s `.next` is never
touched and no cache can lie.

Checkup facts can be pointed at a simulated failure without touching the machine:
`CHECKUP_PG_PORT`, `CHECKUP_NODE_VERSION`, `CHECKUP_PNPM_VERSION`, `CHECKUP_STORAGE_ROOT`,
`CHECKUP_REQUIRED_ENV`.

## Guardrails

`src/lint/loader.ts` discovers `src/lint/rules/*.ts` — each exporting `{ rule, files, severity }` —
and registers them under the `vextrus` namespace, so a new rule never edits `eslint.config.ts`.
The first rule, `vextrus/no-forbidden-escapes`, makes the Q-08 escape hatches lint errors.

## Other commands

`pnpm dev` (port 3210) · `pnpm build` · `pnpm test` · `pnpm test:db` ·
`pnpm e2e --journey <J>` · `pnpm lint` · `pnpm typecheck`
