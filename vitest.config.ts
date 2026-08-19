import { defineConfig } from 'vitest/config';

/**
 * Q-01 / B-03: no cache that can lie — every `pnpm test` run is cold.
 * Journey segments live in `tests/e2e/*.e2e.ts` and are deliberately excluded:
 * they shell out to `pnpm verify`, which would re-enter this run.
 *
 * No CHECKUP_* overrides are injected here. A suite-wide override would leak
 * into every test process in the repo and, worse, would hard-wire the machine
 * facts the checkup acceptance asserts on: a stubbed `CHECKUP_PNPM_VERSION`
 * makes pnpm-pin compare the pin to itself, a stubbed `CHECKUP_UV_VERSION`
 * makes uv-present true on a machine with no uv, and probing port 0 makes the
 * port facts true by construction. AC-02 asks for a healthy machine's report,
 * so the facts stay statements about the real machine; a test that needs a
 * different answer passes the override on its own `runCli` call (AC-03).
 */
export default defineConfig({
  test: {
    cache: false,
    fileParallelism: false,
    /**
     * Every extension executed here is an extension `vextrus/no-forbidden-escapes`
     * lints — the ts and tsx globs it exports. That is the Q-08 contract read the
     * other way round: a test file the runner executes but the guardrail cannot
     * see is a file where a suite modifier shrinks the run with `pnpm verify`
     * still green, which is the lie B-03 forbids. So the fixture tests for the
     * `.mjs` drop-in runners are TypeScript under `tests/scripts/`, importing
     * across the `allowJs` line, rather than `.mjs` beside the runners.
     */
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.next-verify/**', '**/*.e2e.ts'],
    environment: 'node',
  },
});
