/**
 * Shared process helpers for the journey segments.
 *
 * `pnpm verify` and `pnpm checkup` are the increment's observable surface, so
 * the acceptance drives them exactly as a developer would: as child processes,
 * reading stdout/stderr and the exit code (V-VERIFY: "exit code is the whole
 * contract").
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const repoRoot = process.cwd();

export type RunResult = { code: number; stdout: string; stderr: string; output: string };

/** Run a pnpm script to completion. */
export function runScript(
  script: string,
  env: Record<string, string> = {},
  timeoutMs = 300_000,
): RunResult {
  const result = spawnSync('pnpm', ['run', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, ...env, CI: '1', FORCE_COLOR: '0' },
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { code: result.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

/**
 * True when `name` was announced as a stage/fact line.
 *
 * A stage line is one where the name is the first word, allowing decoration
 * such as "→ ", "[3/5] " or "-- ". This deliberately does not match a summary
 * line like "stages: typegen, tsc, eslint, vitest, build", so the fail-fast
 * absence checks in AC-04/AC-05/AC-09 cannot be fooled by a plan banner.
 */
export function announced(output: string, name: string): boolean {
  const line = new RegExp(`^[^A-Za-z]{0,12}(?:stage[^A-Za-z]{0,3})?${name}\\b`, 'i');
  return output.split('\n').some((raw) => line.test(raw.trim()));
}

/** Index of the announcing line, for order assertions (AC-01, AC-11). */
export function announcedAt(output: string, name: string): number {
  const line = new RegExp(`^[^A-Za-z]{0,12}(?:stage[^A-Za-z]{0,3})?${name}\\b`, 'i');
  return output.split('\n').findIndex((raw) => line.test(raw.trim()));
}

/** A checkup fact line: `ok <fact-name> — detail` / `FAIL <fact-name> — detail`. */
export function factLine(output: string, fact: string): string | undefined {
  const re = new RegExp(`^(ok|FAIL)\\s+${fact}(\\s|$)`);
  return output.split('\n').map((l) => l.trim()).find((l) => re.test(l));
}

/** Write a scratch file inside the repo and guarantee its removal. */
export function withScratchFile<T>(relPath: string, contents: string, body: () => T): T {
  const absolute = path.join(repoRoot, relPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, 'utf8');
  try {
    return body();
  } finally {
    rmSync(absolute, { force: true });
  }
}

/** Start the dev server, wait for the URL to answer, then always kill it. */
export async function withDevServer<T>(
  port: number,
  body: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), FORCE_COLOR: '0' },
    stdio: 'ignore',
    detached: true,
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`dev server did not answer on ${baseUrl}`);
      try {
        const probe = await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
        if (probe.ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return await body(baseUrl);
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }
}
