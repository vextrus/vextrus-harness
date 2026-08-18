#!/usr/bin/env node
/**
 * The database lane's entry point. There is no schema at M0 (drizzle and the
 * migration lane arrive later), so this is a stable name with nothing to check
 * yet — it exists so later increments extend a script instead of inventing one.
 */
process.stdout.write('ok test:db — no database lane at M0 (schema arrives with a later increment)\n');
