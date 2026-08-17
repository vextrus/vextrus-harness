/**
 * Shared process/spawn helpers for the acceptance suite.
 * No product source is imported here: everything drives the repo's public
 * entry points (`pnpm verify`, `pnpm checkup`, `pnpm dev`) as a user would.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** vitest runs with the repo root as its root, so cwd is the checkout root. */
export const repoRoot = process.cwd()

export interface RunResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
  /** stdout + stderr, which is what a human reads in the terminal transcript. */
  readonly output: string
}

/**
 * Guard against infinite recursion: these acceptance tests shell out to
 * `pnpm verify`, and verify's own vitest stage runs these same tests. Every
 * spawn below marks its children, and any spawning test refuses to register
 * when it detects it is already running inside such a child.
 */
const NESTED_FLAG = 'VEXTRUS_ACCEPTANCE_NESTED'
export const isNestedRun = process.env[NESTED_FLAG] === '1'

export function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, ...env, [NESTED_FLAG]: '1', CI: '1', FORCE_COLOR: '0' },
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return { status: result.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` }
}

export const pnpm = (args: string[], env: NodeJS.ProcessEnv = {}): RunResult => run('pnpm', args, env)

/** Writes a scratch file and guarantees removal even when the assertion throws. */
export function withScratchFile<T>(relativePath: string, contents: string, body: () => T): T {
  const absolute = resolve(repoRoot, relativePath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents, 'utf8')
  try {
    return body()
  } finally {
    rmSync(absolute, { force: true })
  }
}

/** Occupies a TCP port so a "reachable service" can be simulated without a real server. */
export async function withListener<T>(port: number, body: () => Promise<T> | T): Promise<T> {
  const server = createServer()
  await new Promise<void>((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => { ok() })
  })
  try {
    return await body()
  } finally {
    await new Promise<void>((ok) => { server.close(() => { ok() }) })
  }
}

/** Finds a port with nothing listening on it, for the "unreachable" simulations. */
export async function findClosedPort(): Promise<number> {
  const server = createServer()
  const port = await new Promise<number>((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        fail(new Error('could not allocate a probe port'))
        return
      }
      ok(address.port)
    })
  })
  await new Promise<void>((ok) => { server.close(() => { ok() }) })
  return port
}

/** True when `name` appears in the transcript as a standalone word. */
export function mentionsStage(transcript: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, 'i').test(transcript)
}

export interface DevServer { readonly stop: () => Promise<void> }

export async function startDevServer(port: number): Promise<DevServer> {
  const child = spawn('pnpm', ['dev'], {
    cwd: repoRoot,
    env: { ...process.env, [NESTED_FLAG]: '1', PORT: String(port), FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stop = async (): Promise<void> => {
    child.kill('SIGTERM')
    await new Promise<void>((ok) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); ok() }, 5_000)
      child.once('exit', () => { clearTimeout(timer); ok() })
    })
  }
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) return { stop }
    } catch {
      // server not up yet
    }
    await new Promise((ok) => setTimeout(ok, 500))
  }
  await stop()
  throw new Error(`pnpm dev did not serve http://127.0.0.1:${port}/ within 90s`)
}
