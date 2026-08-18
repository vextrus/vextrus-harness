import type { NextConfig } from 'next';

/**
 * One app, one config. `distDir` is env-driven so `pnpm verify` can build cold
 * into its own directory (V-VERIFY) without ever colliding with `pnpm dev`.
 */
const nextConfig: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
};

export default nextConfig;
