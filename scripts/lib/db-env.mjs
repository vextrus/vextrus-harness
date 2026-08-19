/**
 * The database lane's environment contract, in one place.
 *
 * Shared by the migrate and drift scripts. Every override follows the
 * CHECKUP_PG_PORT convention the scaffold set: an exported-but-empty value is
 * the ordinary shell accident, so it falls back to the default rather than
 * silently pointing the lane at nothing.
 */

/** Dev passwords equal role names — dev-only, and the lane says so out loud. */
export const ROLE_PASSWORDS = Object.freeze({
  vextrus_migrate: 'vextrus_migrate',
  vextrus_app: 'vextrus_app',
  vextrus_auth: 'vextrus_auth',
});

const DEFAULT_BOOTSTRAP_URL = 'postgres://postgres:postgres@127.0.0.1:5544/postgres';
const DEFAULT_DATABASE = 'vextrus_dev';
const DEFAULT_POOL_SIZE = 5;

const trimmed = (name) => (process.env[name] ?? '').trim();

const fallback = (name, value) => {
  const override = trimmed(name);
  return override === '' ? value : override;
};

/** The superuser URL — used only to CREATE ROLE and CREATE DATABASE. */
export const bootstrapUrl = (database) => {
  const url = new URL(fallback('VDB_PG_URL', DEFAULT_BOOTSTRAP_URL));
  if (database !== undefined) url.pathname = `/${database}`;
  return url.toString();
};

/**
 * The database CREATE ROLE and CREATE DATABASE are issued against.
 *
 * Not simply the bootstrap URL: on a virgin cluster that URL may already name
 * the app database, which does not exist yet — pointing the bootstrap at the
 * database it is about to create is the one connection guaranteed to fail. The
 * cluster's maintenance database always exists, so that is where the two
 * statements that bring everything else into being are run.
 */
export const MAINTENANCE_DATABASE = 'postgres';

export const maintenanceUrl = () => bootstrapUrl(MAINTENANCE_DATABASE);

export const appDatabase = () => fallback('VDB_PG_DATABASE', DEFAULT_DATABASE);

export const poolSize = () => {
  const size = Number(fallback('VDB_POOL_SIZE', String(DEFAULT_POOL_SIZE)));
  return Number.isInteger(size) && size > 0 ? size : DEFAULT_POOL_SIZE;
};

/** One role's URL against the app database, derived rather than configured. */
export function roleUrl(role, database = appDatabase()) {
  const url = new URL(bootstrapUrl());
  url.username = role;
  url.password = ROLE_PASSWORDS[role] ?? role;
  url.pathname = `/${database}`;
  return url.toString();
}
