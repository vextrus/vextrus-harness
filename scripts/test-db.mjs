#!/usr/bin/env node
/**
 * The database lane. m0-01 ships no schema, no drizzle and no worker — those
 * arrive in a later increment, which replaces this body. The entry point
 * exists now so the command is stable from the first commit.
 */
process.stdout.write('test:db — no schema lane in this increment; nothing to check\n');
