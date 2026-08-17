import type { NextConfig } from 'next';

/**
 * `distDir` is env-driven so the V-VERIFY build stage can compile cold into
 * `.next-verify` without ever colliding with a running `pnpm dev` (B-03: no
 * cache that can lie).
 */
const config: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
};

export default config;
