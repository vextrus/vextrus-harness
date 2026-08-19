/**
 * The single schema barrel (layout-db, A-M0-4).
 *
 * One line per module and nothing else — no table is declared here. A later
 * increment adds its module and appends exactly one export line; drizzle-kit,
 * the drift check and `src/core/db.ts` all read the schema through this file, so
 * a module that is not exported here does not exist as far as the lane is
 * concerned.
 */
export * from './tenancy';
