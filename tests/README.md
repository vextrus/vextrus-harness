# Acceptance (public)

Written before the implementation; every test here fails on an empty tree.

- `src/lint/__tests__/` — unit/fixture tests beside the code they test (AC-06, AC-12, AC-13).
- `tests/contract/` — the two entry points driven as processes (AC-01…AC-05, AC-07, AC-11).
- `tests/e2e/` — the `scaffold-home` journey segment: `pnpm dev` on 3210, real HTTP (AC-08).

Run:

```
pnpm exec vitest run src/lint tests/contract   # unit + contract
pnpm exec vitest run tests/e2e                 # journey segment (boots pnpm dev)
```

Two things the runners must respect:

1. `tests/e2e/` boots a dev server, so it does not belong in the `vitest run` that
   `pnpm verify` executes — it would spend the Q-01 60 s budget on a server boot and
   contend for port 3210 with the `port-3210` checkup fact.
2. `tests/contract/` drives `pnpm verify`, which itself runs `vitest run`. The child
   is marked with `VEXTRUS_ACCEPTANCE_NESTED=1` and the tests check
   `nestedInVerify()` before spawning, so the lane cannot recurse into itself. Do
   not drop that env var when shelling out.
