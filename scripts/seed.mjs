#!/usr/bin/env node
/**
 * Run every `fixtures/e2e/seed/*.ts` module, in filename order, against one
 * database.
 *
 * The order is the filename's, not a manifest's: a later increment adds seed
 * data by adding `20-projects.ts`, and nothing here has to learn about it. Each
 * module default-exports `async seed({ client })` and gets a connected client
 * with `app.system = 'on'` for the session — the tenant registry is under RLS
 * (SEAM-TENANT), and a seeder is by definition the system rather than a tenant.
 *
 * The modules are TypeScript because their exported constants are typed fixtures
 * later suites import; `jiti` (already in the toolchain) loads them, so the lane
 * gains no TypeScript runner of its own.
 *
 *   VDB_PG_DATABASE=vextrus_e2e_scratch node scripts/seed.mjs
 */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createJiti } from 'jiti';
import pg from 'pg';

const { Client } = pg;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = join(repoRoot, 'fixtures', 'e2e', 'seed');

/** An exported-but-empty override falls back to the default (the m0-02 convention). */
const env = (name, fallback) => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

const bootstrapUrl = () => env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');
const database = env('VDB_PG_DATABASE', 'vextrus_e2e_scratch');

/** The seed connects as the owner: it writes tables only the migrate role owns. */
const roleUrl = (role) => {
  const url = new URL(bootstrapUrl());
  url.username = role;
  url.password = role;
  url.pathname = `/${database}`;
  return url.toString();
};

const say = (line) => process.stdout.write(`${line}\n`);

const modules = readdirSync(SEED_DIR)
  .filter((file) => file.endsWith('.ts'))
  .sort();

const jiti = createJiti(import.meta.url);

const client = new Client({ connectionString: roleUrl('vextrus_migrate') });
await client.connect();
try {
  // Bounded and explicit, for this connection only: seeding is `runAsSystem`.
  await client.query(`select set_config('app.system', 'on', false)`);

  for (const file of modules) {
    const loaded = await jiti.import(join(SEED_DIR, file));
    const seed = loaded?.default ?? loaded;
    if (typeof seed !== 'function') {
      throw new Error(`fixtures/e2e/seed/${file} does not default-export a seed function`);
    }
    await seed({ client });
    say(`seed: ${file} ok`);
  }
  say(`seed: ${database} — ${String(modules.length)} module(s)`);
} catch (error) {
  process.stderr.write(`seed failed — ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
