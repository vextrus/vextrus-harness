/**
 * Side-effect stylesheet imports. Next ships this declaration inside the
 * generated next-env.d.ts, which this project keeps out of the compiler's
 * project: that file also redefines `process.env`, and the environment is the
 * verification harness's to describe.
 */
declare module '*.css'
