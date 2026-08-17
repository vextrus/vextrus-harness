/** V-VERIFY stage 5: a cold production build into its own distDir. */
export const name = 'build';
export const bin = 'next';
export const args = ['build'];
export const env = { NEXT_DIST_DIR: '.next-verify' };
