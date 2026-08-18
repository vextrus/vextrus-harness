import type { NextConfig } from 'next';

/**
 * `distDir` is overridable so `pnpm verify` can build cold into `.next-verify`
 * without ever colliding with the dev server's `.next` (V-VERIFY).
 */
const nextConfig: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
  // The tree is the contract: no generated agent-rules files appear in it.
  agentRules: false,
};

export default nextConfig;
