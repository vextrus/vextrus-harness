/**
 * Journey: scaffold-home — "root page at / with app-title heading served by
 * pnpm dev on 3210". AC-08.
 *
 * This is the only journey in M0-01: it proves the app actually builds and
 * serves, not merely that files exist.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type DevServer, startDevServer, repoRoot } from '../support/proc'

/** Test contract: the dev server port for this app. */
const DEV_PORT = 3210

let server: DevServer | undefined
let homeHtml = ''

beforeAll(async () => {
  // Checkpoint 1: `pnpm dev` starts and serves on 3210.
  server = await startDevServer(DEV_PORT)
  const response = await fetch(`http://127.0.0.1:${DEV_PORT}/`)
  expect(response.status, 'GET / must return 200').toBe(200)
  homeHtml = await response.text()
}, 120_000)

afterAll(async () => { await server?.stop() })

describe('AC-08 scaffold-home journey', () => {
  it('checkpoint: pnpm dev is wired to port 3210', () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    // Test contract: pnpm dev — Next dev server on port 3210.
    expect(pkg.scripts?.['dev']).toMatch(/3210/)
  })

  it('checkpoint: GET / serves a title element carrying data-testid="app-title"', () => {
    // AC-08 / testids: app-title.
    expect(homeHtml, homeHtml.slice(0, 400)).toMatch(/data-testid=["']app-title["']/)
  })

  it('checkpoint: the app-title element has visible text "Vextrus"', () => {
    // AC-08: heading "Vextrus".
    const element = /<(h[1-6])[^>]*data-testid=["']app-title["'][^>]*>([\s\S]*?)<\/\1>/.exec(homeHtml)
    expect(element, `no heading with data-testid="app-title" found in:\n${homeHtml.slice(0, 800)}`).not.toBeNull()
    const visibleText = (element?.[2] ?? '').replace(/<[^>]*>/g, '').trim()
    expect(visibleText).toBe('Vextrus')
  })
})
