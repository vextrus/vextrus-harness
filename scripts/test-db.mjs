#!/usr/bin/env node
/**
 * The database lane's entry point. M0-01 ships no schema, so there is nothing to
 * check yet — the command exists so later increments extend it instead of
 * inventing it, and it stays honest about having found no schema.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './lib/stage.mjs';

const schemaDir = join(repoRoot, 'src', 'db');
if (!existsSync(schemaDir)) {
  process.stdout.write('test:db — no schema in the tree yet; nothing to check\n');
  process.exit(0);
}

process.stdout.write('test:db — schema present; add its checks here\n');
