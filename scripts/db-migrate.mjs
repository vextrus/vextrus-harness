#!/usr/bin/env node
/**
 * Bootstrap the three roles, the database they live in, and apply every
 * migration under `db/migrations/` — in order, as the migrate role, once.
 *
 * The superuser URL is used for exactly two things a non-superuser cannot do:
 * CREATE ROLE and CREATE DATABASE. Everything after that — schema ownership,
 * the migrations themselves, the ledger — runs as `vextrus_migrate`, which is
 * the owner and nothing more: not a superuser, and never BYPASSRLS, because a
 * role that walks past row-level security is a role that can prove nothing.
 *
 * Idempotence is the migration ledger's job. Each migration is hashed over the
 * SQL it actually applies; a hash already in `drizzle.__drizzle_migrations` is a
 * migration already applied, and a second run therefore applies nothing new.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(repoRoot, 'db', 'migrations');

/* ------------------------------------------------------------------ env */

/**
 * An exported-but-empty override is the ordinary shell accident, so it falls
 * back to the default rather than pointing the lane at the empty string — the
 * same convention `CHECKUP_PG_PORT` already set in `scripts/checkup.d/`.
 */
const envOr = (name, fallback) => {
  const value = (process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
};

export const bootstrapUrl = () =>
  envOr('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');

export const appDatabase = () => envOr('VDB_PG_DATABASE', 'vextrus_dev');

/** The three roles, in the order they are created. Dev passwords equal the names. */
export const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'];
const OWNER = 'vextrus_migrate';

/** A connection URL for one role against one database, derived from the bootstrap URL. */
export function roleUrl(role, database) {
  const url = new URL(bootstrapUrl());
  url.username = role;
  url.password = role;
  url.pathname = `/${database}`;
  return url.toString();
}

const databaseUrl = (database) => {
  const url = new URL(bootstrapUrl());
  url.pathname = `/${database}`;
  return url.toString();
};

/* ------------------------------------------------------------------ sql */

/** A single-quoted SQL literal; doubling the quote is the whole escape. */
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** A double-quoted identifier. */
const ident = (value) => `"${String(value).replace(/"/g, '""')}"`;

const say = (line) => process.stdout.write(`${line}\n`);

async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/* ------------------------------------------------------------ migrations */

/**
 * Every migration in the tree, in order: one directory per migration, holding
 * one or more `.sql` files applied in filename order. `meta/` is drizzle-kit's
 * snapshot directory — the drift check's input, not a migration.
 */
export function migrationsInOrder(root = MIGRATIONS) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'meta')
    .map((entry) => entry.name)
    .sort()
    .map((tag) => {
      const dir = join(root, tag);
      const files = readdirSync(dir)
        .filter((file) => file.endsWith('.sql'))
        .sort();
      const sql = files.map((file) => readFileSync(join(dir, file), 'utf8')).join('\n');
      return { tag, files, sql, hash: createHash('sha256').update(sql).digest('hex') };
    });
}

/* ------------------------------------------------------------- bootstrap */

async function ensureRoles(client) {
  for (const role of ROLES) {
    const { rows } = await client.query(
      `select 1 from pg_roles where rolname = ${lit(role)}`,
    );
    if (rows.length === 0) {
      await client.query(
        `create role ${ident(role)} login password ${lit(role)} nosuperuser nobypassrls nocreatedb nocreaterole`,
      );
      say(`created role ${role}`);
    }
    // Stated every run, not only on creation: the attributes are the contract,
    // and a role somebody hand-edited into BYPASSRLS is a seam that proves
    // nothing. Dev passwords equal the role names (AC-01).
    await client.query(
      `alter role ${ident(role)} with login password ${lit(role)} nosuperuser nobypassrls nocreatedb nocreaterole`,
    );
  }
}

async function ensureDatabase(client, database) {
  const { rows } = await client.query(
    `select 1 from pg_database where datname = ${lit(database)}`,
  );
  if (rows.length === 0) {
    // CREATE DATABASE runs outside any transaction block, so it is its own call.
    await client.query(`create database ${ident(database)} owner ${ident(OWNER)}`);
    say(`created database ${database} owned by ${OWNER}`);
  }
}

async function ensureOwnership(client, database) {
  await client.query(`alter database ${ident(database)} owner to ${ident(OWNER)}`);
  await client.query(`alter schema "public" owner to ${ident(OWNER)}`);
  await client.query(`revoke connect on database ${ident(database)} from public`);
  for (const role of ROLES) {
    await client.query(`grant connect on database ${ident(database)} to ${ident(role)}`);
  }
}

/* ---------------------------------------------------------------- ledger */

const LEDGER = 'drizzle.__drizzle_migrations';

async function ensureLedger(client) {
  await client.query('create schema if not exists "drizzle"');
  await client.query(
    `create table if not exists ${LEDGER} (
       id serial primary key,
       hash text not null,
       created_at bigint
     )`,
  );
  // The ledger is the migrate role's alone: an app connection that can rewrite
  // the record of what ran can lie about what ran.
  await client.query('revoke all on schema "drizzle" from public');
  await client.query(`revoke all on ${LEDGER} from public`);
}

/* ------------------------------------------------------------------ main */

const database = appDatabase();

await withClient(bootstrapUrl(), async (client) => {
  await ensureRoles(client);
  await ensureDatabase(client, database);
});
await withClient(databaseUrl(database), (client) => ensureOwnership(client, database));

const applied = await withClient(roleUrl(OWNER, database), async (client) => {
  const who = (await client.query('select current_user as who')).rows[0].who;
  if (who !== OWNER) throw new Error(`migrations must run as ${OWNER}, connected as ${who}`);

  await ensureLedger(client);
  const { rows } = await client.query(`select hash from ${LEDGER}`);
  const known = new Set(rows.map((row) => row.hash));

  let count = 0;
  for (const migration of migrationsInOrder()) {
    if (known.has(migration.hash)) {
      say(`skip ${migration.tag} — already applied`);
      continue;
    }
    // One migration, one transaction: a migration that fails half-way leaves the
    // database where it was and the ledger silent about it.
    await client.query('begin');
    try {
      await client.query(migration.sql);
      await client.query(
        `insert into ${LEDGER} (hash, created_at) values (${lit(migration.hash)}, ${Date.now()})`,
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`migration ${migration.tag} failed: ${error.message}`);
    }
    say(`applied ${migration.tag} (${migration.files.join(', ')})`);
    count += 1;
  }
  return count;
});

say(`db:migrate ${database} — ${applied} migration(s) applied, roles ${ROLES.join(', ')}`);
