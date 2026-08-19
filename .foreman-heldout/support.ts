/**
 * Held-out support: the product is reached only through the entry points the
 * increment spec names — `pnpm e2e`, `node scripts/seed.mjs`, the worker entry —
 * and through the database URL the spec documents. Nothing here reads product
 * source.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

import pg from 'pg';

export const repoRoot = (): string => process.env['FOREMAN_REPO_ROOT'] ?? process.cwd();

export interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

export function runCli(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
  timeoutMs = 900_000,
): CliResult {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (typeof value === 'string') merged[key] = value;
  }
  const result = spawnSync(command, [...args], {
    cwd: repoRoot(),
    encoding: 'utf8',
    env: merged,
    timeout: timeoutMs,
    shell: false,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
}

/** One `pnpm e2e ...` invocation. */
export const lane = (
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): CliResult => runCli('pnpm', ['e2e', ...args], env);

export const lines = (output: string): string[] =>
  output.split('\n').map((line) => line.trim());

export const hasLine = (output: string, needle: string): boolean =>
  lines(output).some((line) => line.includes(needle));

let browsersReady = false;
/** Chromium, once per run: the CI job installs it, a local gate may not have. */
export function ensureBrowsers(): void {
  if (browsersReady) return;
  browsersReady = true;
  runCli('pnpm', ['exec', 'playwright', 'install', 'chromium'], {}, 600_000);
}

export const ARTIFACTS = ['var', 'e2e', 'artifacts'] as const;

export function artifactFiles(): string[] {
  const root = join(repoRoot(), ...ARTIFACTS);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else out.push(relative(root, child));
    }
  };
  walk(root);
  return out;
}

export function clearArtifacts(): void {
  rmSync(join(repoRoot(), ...ARTIFACTS), { recursive: true, force: true });
}

const BOOTSTRAP_URL = (): string => {
  const value = (process.env['VDB_PG_URL'] ?? '').trim();
  return value === '' ? 'postgres://postgres:postgres@127.0.0.1:5544/postgres' : value;
};

export const SCRATCH_DATABASE = 'vextrus_e2e_scratch';

/**
 * The scratch database's oid, or undefined when it does not exist. An oid that
 * changed is a database that was dropped and created again, which no amount of
 * "create if missing" can fake.
 */
export async function scratchOid(): Promise<string | undefined> {
  const client = new pg.Client({ connectionString: BOOTSTRAP_URL() });
  await client.connect();
  try {
    const result = await client.query('select oid::text as oid from pg_database where datname = $1', [
      SCRATCH_DATABASE,
    ]);
    const row: Record<string, unknown> | undefined = result.rows[0];
    return row === undefined ? undefined : String(row['oid']);
  } finally {
    await client.end().catch(() => undefined);
  }
}
