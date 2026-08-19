/**
 * The single schema barrel (A-M0-4).
 *
 * One module per area, composed exactly once. A later increment appends one
 * line here and nothing else — no table is declared in this file, and the live
 * seam suite discovers whatever the migration created rather than reading a list.
 */
export * from './tenancy';
