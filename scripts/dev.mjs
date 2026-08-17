#!/usr/bin/env node
/**
 * `pnpm dev` — the development server on port 3210.
 *
 * It runs Next in its own process group and tears that group down when this
 * process is asked to stop *or* when whoever started it goes away. A test (or
 * a terminal) that kills the package-manager wrapper does not otherwise reach
 * the server underneath it, and a server left holding 3210 makes the next
 * `pnpm checkup` report a fact that is not true.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flagIndex = args.findIndex((arg) => arg === '--port' || arg === '-p')
const fromFlag = flagIndex >= 0 ? args[flagIndex + 1] : undefined
const port = process.env['PORT'] ?? fromFlag ?? '3210'

const child = spawn(resolve(repoRoot, 'node_modules', '.bin', 'next'), ['dev', '-p', port], {
  cwd: repoRoot,
  stdio: 'inherit',
  detached: true,
  env: { ...process.env, PORT: port },
})

let stopping = false

const stopGroup = (signal) => {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    // the group is already gone
  }
}

const stop = (signal) => {
  if (stopping) return
  stopping = true
  stopGroup(signal)
  const timer = setTimeout(() => {
    stopGroup('SIGKILL')
    process.exit(1)
  }, 5_000)
  timer.unref()
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stop('SIGTERM') })
}

// Whoever started this process may be killed without passing the signal on.
const startedUnder = process.ppid
const orphanWatch = setInterval(() => {
  if (process.ppid !== startedUnder) {
    stop('SIGTERM')
    setTimeout(() => { stopGroup('SIGKILL'); process.exit(0) }, 2_000).unref()
  }
}, 250)
orphanWatch.unref()

child.on('exit', (code, signal) => {
  clearInterval(orphanWatch)
  process.exit(code ?? (signal === null ? 0 : 1))
})
