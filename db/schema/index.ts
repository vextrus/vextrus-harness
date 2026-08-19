/**
 * The single barrel (layout-db, A-M0-4). One schema module per app module,
 * composed exactly once here: a later increment appends one line and nothing
 * else changes — not the migrate script, not the drift check, not the seam
 * suite, which discovers its tables from the migrated catalog.
 *
 * No `pgTable` lives in this file. It composes; it does not declare.
 */
export * from './tenancy';
