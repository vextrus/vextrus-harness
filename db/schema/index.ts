/**
 * The single schema barrel (layout-db, A-M0-4).
 *
 * One schema per module, composed once. A later increment adds a module and one
 * line here — nothing else in the tree learns its name, because the migration
 * lane reads this file and the live suite discovers its tables from the migrated
 * database rather than from a list.
 */
export * from './tenancy';
