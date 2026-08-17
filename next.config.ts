import type { NextConfig } from 'next';

/**
 * `pnpm verify` builds cold into its own distDir (V-VERIFY) so a verify run can
 * never collide with, or be warmed by, a running `pnpm dev`.
 */
const nextConfig: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
};

export default nextConfig;
