import type { NextConfig } from 'next';

/**
 * `distDir` is overridable so `pnpm verify` can build cold into `.next-verify`
 * without ever colliding with the dev server's `.next` (V-VERIFY).
 *
 * `tsconfigPath` is overridable for the same reason: `next build`/`next typegen`
 * rewrite the tsconfig they are given, so verify hands them a per-process
 * scratch file that extends the real one (scripts/lib/stage.mjs) and the tracked
 * `tsconfig.json` is never written — by this run or by a concurrent one.
 */
const nextConfig: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  typescript: { tsconfigPath: process.env['NEXT_TSCONFIG_PATH'] ?? 'tsconfig.json' },
  // The tree is the contract: no generated agent-rules files appear in it.
  agentRules: false,
};

export default nextConfig;
