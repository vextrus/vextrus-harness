import { readFileSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

/**
 * Q-01 / B-03: no cache that can lie — every `pnpm test` run is cold.
 * Journey segments live in `tests/e2e/*.e2e.ts` and are deliberately excluded:
 * they shell out to `pnpm verify`, which would re-enter this run.
 */

/**
 * V-VERIFY: "the exit code is the whole contract" — the contract being the tree,
 * not the machine. `tests/acceptance/*.spec.ts` drives the real `pnpm checkup`
 * CLI, whose facts are statements about this machine; run bare inside verify's
 * vitest stage they would turn a missing `uv`, an older Node, a different local
 * pnpm or a `pnpm dev` holding port 3210 into a red `pnpm verify`.
 *
 * So every machine fact gets its test-only override here (the same overrides
 * AC-03 uses to simulate failures). What the suite then proves is the shape of
 * the report — every fact named, the ok/FAIL format, not fail-fast — while the
 * facts themselves stay the business of the separate `pnpm checkup` lane, where
 * a red answer means something.
 */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const nodePin = read('./.nvmrc').trim().replace(/^v/, '');
const pnpmPin = String((JSON.parse(read('./package.json')) as { packageManager?: string })
  .packageManager ?? '')
  .replace(/^pnpm@/, '')
  .split('+')[0] ?? '';

export default defineConfig({
  test: {
    cache: false,
    fileParallelism: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/.next-verify/**', '**/*.e2e.ts'],
    environment: 'node',
    env: {
      CHECKUP_NODE_VERSION: nodePin,
      CHECKUP_PNPM_VERSION: pnpmPin,
      CHECKUP_UV_VERSION: 'stubbed by vitest.config.ts',
      // Port 0 is an ephemeral port: the bind/close machinery is exercised for
      // real, the developer's 3210/3211 are left alone.
      CHECKUP_PORT_3210: '0',
      CHECKUP_PORT_3211: '0',
    },
  },
});
