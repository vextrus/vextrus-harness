#!/usr/bin/env node
/**
 * Bootstrap and migrate: the one way the database comes into existence.
 *
 * Two phases, two connections, and the split is the point (SEAM-TENANT):
 *
 *   1. Bootstrap, on the superuser URL. Creates the three roles — `vextrus_migrate`
 *      (owner), `vextrus_app` (runtime, RLS-subject), `vextrus_auth` (auth module) —
 *      none superuser, none BYPASSRLS, and the database owned by the migrate role.
 *      This is the only phase that needs a superuser, and it does nothing else.
 *   2. Migration, as `vextrus_migrate`. Every directory under `db/migrations/` named
 *      by the journal is applied in order, in one transaction each, and recorded in
 *      `drizzle.__drizzle_migrations` — a ledger in a schema the app role cannot
 *      even see, so a runtime connection can neither read nor rewrite the history
 *      of its own database.
 *
 * Idempotent by the ledger, not by hope: a second run finds every hash already
 * recorded and applies nothing.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { appDatabase, bootstrapUrl, maintenanceUrl, ROLE_PASSWORDS, roleUrl } from './lib/db-env.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(repoRoot, 'db', 'migrations');

const say = (line) => process.stdout.write(`${line}\n`);

/** Opens a client, hands it to `work`, and always closes it. */
async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * The journal is the order. A migration is a *directory* of `.sql` files applied
 * in filename order, so the generated schema SQL and the hand-written seam SQL
 * that Drizzle cannot express (FORCE RLS, grants, the append-only trigger) are
 * one migration rather than two lanes.
 */
function plannedMigrations() {
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'));
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const dir = join(migrationsDir, entry.tag);
      const files = readdirSync(dir)
        .filter((name) => name.endsWith('.sql'))
        .sort();
      const sql = files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');
      return {
        tag: entry.tag,
        files,
        // Drizzle's own breakpoint marker is a comment to Postgres; the whole
        // migration goes to the server as one script inside one transaction.
        sql: sql.replaceAll('--> statement-breakpoint', ''),
        hash: createHash('sha256').update(sql).digest('hex'),
      };
    });
}

/* --------------------------------------------------------------- phase one */

async function bootstrap() {
  const database = appDatabase();

  await withClient(maintenanceUrl(), async (client) => {
    for (const [role, password] of Object.entries(ROLE_PASSWORDS)) {
      const { rows } = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      if (rows.length === 0) {
        await client.query(`create role "${role}" login password '${password}'`);
        say(`created role ${role}`);
      }
      // Stated every run, so a role that was hand-edited into a superuser is put
      // back: the guarantee is about the database as it is, not as it was made.
      await client.query(
        `alter role "${role}" with login nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${password}'`,
      );
    }

    const { rows } = await client.query('select 1 from pg_database where datname = $1', [database]);
    if (rows.length === 0) {
      await client.query(`create database "${database}" owner "vextrus_migrate"`);
      say(`created database ${database}`);
    }
  });

  // Schema-level privilege is the superuser's to give; everything below this
  // line belongs to the migrate role.
  await withClient(bootstrapUrl(database), async (client) => {
    await client.query(`alter schema "public" owner to "vextrus_migrate"`);
    await client.query(`revoke create on schema "public" from public`);
    await client.query(
      `revoke create on schema "public" from "vextrus_app", "vextrus_auth"`,
    );
    await client.query(`grant usage on schema "public" to "vextrus_app"`);
    await client.query(
      `grant connect on database "${database}" to "vextrus_app", "vextrus_auth"`,
    );
  });
}

/* --------------------------------------------------------------- phase two */

async function migrate() {
  const database = appDatabase();
  const planned = plannedMigrations();

  await withClient(roleUrl('vextrus_migrate', database), async (client) => {
    // The ledger lives where the runtime role has no USAGE at all — protection
    // by absence of grant rather than by a policy somebody can add an exception to.
    await client.query('create schema if not exists "drizzle"');
    await client.query('revoke all on schema "drizzle" from public');
    await client.query(`
      create table if not exists "drizzle"."__drizzle_migrations" (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `);

    const { rows } = await client.query('select hash from "drizzle"."__drizzle_migrations"');
    const applied = new Set(rows.map((row) => row.hash));

    let count = 0;
    for (const migration of planned) {
      if (applied.has(migration.hash)) continue;
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into "drizzle"."__drizzle_migrations" (hash, created_at) values ($1, $2)',
          [migration.hash, Date.now()],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${migration.tag} failed: ${error.message}`);
      }
      say(`applied ${migration.tag} (${migration.files.join(', ')})`);
      count += 1;
    }
    say(
      count === 0
        ? `up to date — ${planned.length} migration(s) already recorded in drizzle.__drizzle_migrations`
        : `applied ${count} migration(s) of ${planned.length}`,
    );
  });
}

try {
  await bootstrap();
  await migrate();
} catch (error) {
  process.stderr.write(`db:migrate failed — ${error.message}\n`);
  process.exitCode = 1;
}
