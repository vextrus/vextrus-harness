/**
 * The verification lane builds into its own distDir so a cold production
 * compile can never collide with — or warm a cache from — the dev server's
 * `.next`. Stages set NEXT_DIST_DIR; nothing else does.
 *
 * The config is deliberately untyped-by-import: pulling Next's type entry in
 * also pulls its global declarations, which redefine `process.env` for the
 * whole project.
 */
const nextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',
}

export default nextConfig
