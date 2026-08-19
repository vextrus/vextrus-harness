#!/usr/bin/env node
/**
 * Bootstrap the three roles, then apply every migration as the owner.
 *
 * Two connections, two privilege levels, and the line between them is the whole
 * point of the script:
 *
 *   - the bootstrap URL (a superuser) exists only to CREATE ROLE and CREATE
 *     DATABASE — the two things no lesser role can do — and is dropped as soon
 *     as they are done;
 *   - everything that touches the schema runs as `vextrus_migrate`, so every
 *     object in the app database is owned by the migrate role and by nothing
 *     else (AC-05).
 *
 * Idempotence is the contract (AC-01): roles are created if absent and their
 * attributes reasserted every run — none superuser, none BYPASSRLS, dev
 * passwords equal to the role names — and a migration is applied only when its
 * hash is absent from `drizzle.__drizzle_migrations`. A second immediate run
 * therefore exits 0 having applied nothing.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

import { repoRoot } from './lib/stage.mjs';

/**
 * An exported-but-empty variable falls back to the default, the same way
 * `CHECKUP_PG_PORT` does: `VDB_PG_URL=` in a shell profile must not mean "no
 * database".
 */
const env = (name, fallback) => {
  const raw = (process.env[name] ?? '').trim();
  return raw === '' ? fallback : raw;
};

export const BOOTSTRAP_URL = env('VDB_PG_URL', 'postgres://postgres:postgres@127.0.0.1:5544/postgres');
export const DATABASE = env('VDB_PG_DATABASE', 'vextrus_dev');

/** migrate owns every object; app is the runtime; auth is the auth module's own. */
const ROLES = ['vextrus_migrate', 'vextrus_app', 'vextrus_auth'];

const MIGRATIONS_DIR = join(repoRoot, 'db', 'migrations');

/** The URL of one role against one database. Dev passwords equal the role name. */
export function roleUrl(role, database = DATABASE) {
  const url = new URL(BOOTSTRAP_URL);
  url.username = role;
  url.password = role;
  url.pathname = `/${database}`;
  return url.toString();
}

const quote = (identifier) => `"${identifier.replace(/"/g, '""')}"`;
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function connect(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

/**
 * Migrations are directories, not files: one increment's migration is a folder
 * of SQL applied in filename order, so the drizzle-kit output and the hand-written
 * SQL beside it (grants, FORCE RLS, triggers) travel together as one unit with
 * one hash. `meta/` is drizzle-kit's own bookkeeping and is not a migration.
 */
function migrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry !== 'meta' && statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort()
    .map((tag) => {
      const dir = join(MIGRATIONS_DIR, tag);
      const files = readdirSync(dir)
        .filter((entry) => entry.endsWith('.sql'))
        .sort();
      const sql = files.map((file) => readFileSync(join(dir, file), 'utf8'));
      return { tag, files, sql };
    });
}

/** drizzle-kit's own statement separator: a marker for readers, not SQL. */
const strip = (sql) => sql.replace(/-->\s*statement-breakpoint/g, '');

const hashOf = (parts) => createHash('sha256').update(parts.join('\n')).digest('hex');

async function bootstrap() {
  const client = await connect(BOOTSTRAP_URL);
  try {
    for (const role of ROLES) {
      // CREATE ROLE has no IF NOT EXISTS, and a second run must not be an error.
      await client.query(`
        DO $bootstrap$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN
            CREATE ROLE ${quote(role)} LOGIN PASSWORD ${literal(role)};
          END IF;
        END $bootstrap$;
      `);
      // Reasserted every run: a role that drifted to superuser or BYPASSRLS is a
      // seam with no floor under it, and the fix must not need a human.
      await client.query(
        `ALTER ROLE ${quote(role)} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(role)}`,
      );
    }

    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
    if (existing.rows.length === 0) {
      await client.query(`CREATE DATABASE ${quote(DATABASE)} OWNER ${quote('vextrus_migrate')}`);
      process.stdout.write(`created database ${DATABASE} owned by vextrus_migrate\n`);
    } else {
      // A database left behind by an earlier tree may be owned by the bootstrap
      // user; the owner is part of the contract, so it is restated.
      await client.query(`ALTER DATABASE ${quote(DATABASE)} OWNER TO ${quote('vextrus_migrate')}`);
    }
    for (const role of ['vextrus_app', 'vextrus_auth']) {
      await client.query(`GRANT CONNECT ON DATABASE ${quote(DATABASE)} TO ${quote(role)}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * The migration ledger. It lives in its own schema, owned by migrate and granted
 * to nobody: a runtime role that can rewrite the record of what ran can make the
 * database lie about its own shape.
 */
async function ensureLedger(client) {
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  await client.query('REVOKE ALL ON SCHEMA drizzle FROM PUBLIC');
  await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC');
  for (const role of ['vextrus_app', 'vextrus_auth']) {
    await client.query(`REVOKE ALL ON SCHEMA drizzle FROM ${quote(role)}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM ${quote(role)}`);
  }
}

async function apply() {
  const client = await connect(roleUrl('vextrus_migrate'));
  try {
    await ensureLedger(client);
    const applied = await client.query('SELECT hash FROM drizzle.__drizzle_migrations');
    const seen = new Set(applied.rows.map((row) => row.hash));

    let count = 0;
    for (const migration of migrations()) {
      const hash = hashOf(migration.sql);
      if (seen.has(hash)) {
        process.stdout.write(`skip ${migration.tag} — already applied\n`);
        continue;
      }
      // One transaction per migration: a migration that fails half way leaves
      // the database as it was, and the ledger unchanged with it.
      await client.query('BEGIN');
      try {
        for (const sql of migration.sql) await client.query(strip(sql));
        await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [
          hash,
          Date.now(),
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${migration.tag} failed: ${error.message}`);
      }
      count += 1;
      process.stdout.write(`applied ${migration.tag} (${migration.files.join(', ')})\n`);
    }
    process.stdout.write(
      count === 0 ? 'nothing to apply — the database is up to date\n' : `applied ${count} migration(s)\n`,
    );
  } finally {
    await client.end();
  }
}

await bootstrap();
await apply();
