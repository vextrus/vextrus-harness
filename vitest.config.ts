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
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
      // The drop-in runners are `.mjs` and belong to no tsconfig project, so
      // their fixture tests live beside them in the same module system.
      'scripts/**/*.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.next-verify/**', '**/*.e2e.ts'],
    environment: 'node',
  },
});
