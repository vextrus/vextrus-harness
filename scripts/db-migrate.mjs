#!/usr/bin/env node
/**
 * Bootstrap the three roles and apply every migration, in order, as the owner.
 *
 * The only thing a superuser is used for is what only a superuser can do —
 * CREATE ROLE and CREATE DATABASE. Everything after that runs as
 * `vextrus_migrate`, which is why `vextrus_migrate` ends up owning every object:
 * ownership is a consequence of who ran the DDL, not a step somebody remembered.
 *
 * Idempotent by construction. Roles are created if absent and their attributes
 * reasserted every run (a role that drifted to BYPASSRLS is a role that silently
 * turns SEAM-TENANT off). Migrations are recorded by content hash in
 * `drizzle.__drizzle_migrations`, so a second run applies nothing and exits 0.
 *
 * It never drops anything. A migration lane is append-only (layout-db); a script
 * that can reset the database is a script that will.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(repoRoot, 'db', 'migrations');

/** An exported-but-empty override falls back to the default (the CHECKUP_PG_PORT convention). */
const env = (name, fallback) => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

const bootstrapUrl = () => env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');
const DATABASE = () => env('VDB_PG_DATABASE', 'vextrus_dev');

/** The migrated database reached as `role`, whose dev password is its own name. */
const roleUrl = (role, database) => {
  const url = new URL(bootstrapUrl());
  url.username = role;
  url.password = role;
  url.pathname = `/${database}`;
  return url.toString();
};

/** migrate owns, app runs, auth authenticates. Nothing else ever connects. */
const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'];

const say = (line) => process.stdout.write(`${line}\n`);

/** One connection, one job, closed whatever happens. */
async function withClient(connectionString, work) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * The role attributes SEAM-TENANT depends on, reasserted every run.
 *
 * NOSUPERUSER and NOBYPASSRLS are the load-bearing pair: either one turns every
 * policy in the database into a comment. The dev password equals the role name
 * by contract — this lane targets a scratch cluster, and a credential nobody has
 * to look up is one nobody writes into a test fixture by hand.
 */
async function ensureRoles(client) {
  for (const role of ROLES) {
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
    if (exists.rowCount === 0) {
      await client.query(
        `create role ${role} login password '${role}' nosuperuser nobypassrls nocreatedb nocreaterole inherit`,
      );
      say(`role ${role} created`);
    }
    await client.query(
      `alter role ${role} login password '${role}' nosuperuser nobypassrls nocreatedb nocreaterole inherit`,
    );
  }
}

/** The database, owned by the migrate role so every later object is too. */
async function ensureDatabase(client, database) {
  const exists = await client.query('select 1 from pg_database where datname = $1', [database]);
  if (exists.rowCount === 0) {
    // No parameters: CREATE DATABASE cannot take them.
    await client.query(`create database "${database}" owner vextrus_migrate`);
    say(`database ${database} created`);
  } else {
    await client.query(`alter database "${database}" owner to vextrus_migrate`);
  }
  await client.query(`grant connect on database "${database}" to vextrus_app, vextrus_auth`);
}

/**
 * A migration is a directory: its `*.sql` files in filename order, applied as one
 * transaction and hashed as one unit. Directories rather than single files
 * because the lane has two kinds of statement — what drizzle-kit generates, and
 * the raw SQL it cannot (FORCE RLS, grants, triggers) — and they belong to the
 * same atomic step.
 */
function discoverMigrations() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'meta')
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const dir = join(MIGRATIONS_DIR, name);
      const files = readdirSync(dir)
        .filter((file) => file.endsWith('.sql'))
        .sort();
      const statements = files.map((file) => ({
        file,
        sql: readFileSync(join(dir, file), 'utf8'),
      }));
      const hash = createHash('sha256')
        .update(statements.map((s) => `${s.file}\n${s.sql}`).join('\n'))
        .digest('hex');
      return { name, files, statements, hash };
    })
    .filter((migration) => migration.files.length > 0);
}

/**
 * The ledger, at the path drizzle uses and with drizzle's own columns, so a
 * later switch to `drizzle-orm/node-postgres/migrator` reads the same history.
 * It lives in its own schema with no grant to anybody: the app role must not be
 * able to tell the database a migration it never ran has already been applied.
 */
async function ensureLedger(client) {
  await client.query('create schema if not exists drizzle');
  await client.query(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  await client.query('revoke all on schema drizzle from public');
  await client.query('revoke all on all tables in schema drizzle from public');
  await client.query('revoke all on schema drizzle from vextrus_app, vextrus_auth');
  await client.query(
    'revoke all on all tables in schema drizzle from vextrus_app, vextrus_auth',
  );
}

const database = DATABASE();

await withClient(bootstrapUrl(), async (client) => {
  await ensureRoles(client);
  await ensureDatabase(client, database);
});

const migrations = discoverMigrations();
if (migrations.length === 0) {
  say('no migrations found under db/migrations/');
}

const applied = await withClient(roleUrl('vextrus_migrate', database), async (client) => {
  await ensureLedger(client);
  const known = new Set(
    (await client.query('select hash from drizzle.__drizzle_migrations')).rows.map(
      (row) => row.hash,
    ),
  );

  let count = 0;
  for (const migration of migrations) {
    if (known.has(migration.hash)) continue;
    await client.query('begin');
    try {
      for (const statement of migration.statements) {
        // The whole file in one simple-query round trip: drizzle's
        // `--> statement-breakpoint` markers are SQL comments, and splitting on
        // them would cut a `$$`-quoted function body in half.
        await client.query(statement.sql);
      }
      await client.query(
        'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
        [migration.hash, Date.now()],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw new Error(`migration ${migration.name} failed: ${error.message}`, { cause: error });
    }
    say(`applied ${migration.name} (${migration.files.join(', ')})`);
    count += 1;
  }
  return count;
});

say(`db:migrate ${database} — ${String(applied)} applied, ${String(migrations.length - applied)} already present`);

// Never `process.exit()`: stdout is a pipe whenever a caller captures this run,
// and a piped stdout drains asynchronously.
process.exitCode = 0;
