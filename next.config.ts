import type { NextConfig } from 'next';

/**
 * One app, one config (B-03). `pnpm verify` builds into its own distDir so a
 * cold verification build can never read or clobber the dev server's cache
 * (Q-01: "no cache that can lie").
 */
const nextConfig: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
};

export default nextConfig;
