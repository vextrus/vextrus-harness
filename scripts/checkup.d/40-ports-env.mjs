import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { portBindable } from '../lib/probe.mjs';

/**
 * Ports the app claims, the storage root it writes to, and the environment it
 * needs. Ports are probed by really binding and really closing — anything less
 * would let a leaked socket make the next run lie.
 */
const WEB_PORT = 3210;
const E2E_PORT = 3211;

/** Env this increment requires. Later increments add their own checkup.d file
 *  rather than editing this one. */
const REQUIRED_ENV = [];

/** Recognised optional overrides, reported so the transcript explains itself. */
const OPTIONAL_ENV = [
  'CHECKUP_PG_PORT',
  'CHECKUP_NODE_VERSION',
  'CHECKUP_PNPM_VERSION',
  'CHECKUP_STORAGE_ROOT',
  'NEXT_DIST_DIR',
];

function storageRoot(repoRoot) {
  const override = process.env.CHECKUP_STORAGE_ROOT;
  if (override !== undefined && override.length > 0) {
    return isAbsolute(override) ? override : join(repoRoot, override);
  }
  return join(repoRoot, 'var', 'storage');
}

export const facts = [
  { name: 'port-3210', check: () => portBindable(WEB_PORT) },
  { name: 'port-3211', check: () => portBindable(E2E_PORT) },
  {
    name: 'storage-root',
    check: ({ repoRoot }) => {
      const root = storageRoot(repoRoot);
      try {
        if (!statSync(root).isDirectory()) return { ok: false, detail: `${root} is not a directory` };
        accessSync(root, constants.W_OK);
        return { ok: true, detail: `${root} exists and is writable` };
      } catch (error) {
        return { ok: false, detail: `${root} unusable (${error.code ?? error.message})` };
      }
    },
  },
  {
    name: 'env',
    check: () => {
      const missing = REQUIRED_ENV.filter((key) => (process.env[key] ?? '').length === 0);
      const set = OPTIONAL_ENV.filter((key) => (process.env[key] ?? '').length > 0);
      return {
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? `${REQUIRED_ENV.length} required present, ${set.length}/${OPTIONAL_ENV.length} optional overrides set`
            : `missing: ${missing.join(', ')}`,
      };
    },
  },
];
