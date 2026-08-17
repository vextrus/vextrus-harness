/**
 * AC-02, AC-03 — `pnpm checkup` is the machine's report (V-CHECKUP):
 * every fact named, one line each, not fail-fast, exit code is the summary.
 *
 * Health and failure are both simulated through the documented CHECKUP_*
 * env overrides so the run is reproducible and never mutates the machine.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { closedPort, nested, pnpm, repoRoot, withListener, withPortLock, checkpoint } from '../support/proc';

const FACTS = [
  'node-pin',
  'pnpm-pin',
  'uv-present',
  'postgres-5544',
  'port-3210',
  'port-3211',
  'storage-root',
  'env',
] as const;

type Fact = (typeof FACTS)[number];

/** `ok <fact-name> — detail` / `FAIL <fact-name> — detail` */
function factLine(output: string, fact: Fact): string | undefined {
  const pattern = new RegExp(`^\\s*(ok|FAIL)\\s+${fact}\\s+[—-]\\s+.+$`, 'm');
  return output.match(pattern)?.[0]?.trim();
}

function marker(output: string, fact: Fact): 'ok' | 'FAIL' | undefined {
  const line = factLine(output, fact);
  return line?.startsWith('FAIL') === true ? 'FAIL' : line === undefined ? undefined : 'ok';
}

const storageRoot = mkdtempSync(path.join(tmpdir(), 'vextrus-storage-'));
afterAll(() => rmSync(storageRoot, { recursive: true, force: true }));

function pins(): { node: string; pnpm: string } {
  const nvmrc = readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    packageManager?: string;
  };
  const pnpmPin = (pkg.packageManager ?? '').replace(/^pnpm@/, '').split('+')[0] ?? '';
  return { node: nvmrc.startsWith('v') ? nvmrc : `v${nvmrc}`, pnpm: pnpmPin };
}

describe('AC-02/AC-03 pnpm checkup', () => {
  if (nested) {
    it('is skipped inside a verify run (recursion guard)', () => {
      expect(nested).toBe(true);
    });
    return;
  }

  it(
    'AC-02: a healthy machine reports all eight facts by name, each with an ok marker, and exits 0',
    async () => {
      const { node, pnpm: pnpmPin } = pins();
      const result = await withPortLock(() =>
        withListener((pgPort) =>
          pnpm(['checkup'], {
            env: {
              CHECKUP_NODE_VERSION: node,
              CHECKUP_PNPM_VERSION: pnpmPin,
              CHECKUP_PG_PORT: String(pgPort),
              CHECKUP_STORAGE_ROOT: storageRoot,
            },
            timeoutMs: 120_000,
          }),
        ),
      );

      for (const fact of FACTS) {
        expect(factLine(result.all, fact), `fact "${fact}" was not reported`).toBeTruthy();
      }
      const failed = FACTS.filter((fact) => marker(result.all, fact) === 'FAIL');
      expect(failed, `facts reported as failed on a simulated-healthy machine:\n${result.all}`).toEqual([]);
      expect(result.code, `checkup must exit 0 when every fact is ok:\n${result.all}`).toBe(0);

      checkpoint('checkup-report', `${FACTS.length} facts ok, exit ${String(result.code)}`);
    },
    120_000,
  );

  it(
    'AC-03: one failing fact (Postgres on a closed port) exits non-zero, names that fact, and the other seven are still reported',
    async () => {
      const { node, pnpm: pnpmPin } = pins();
      const deadPort = await closedPort();
      const result = await withPortLock(() =>
        pnpm(['checkup'], {
          env: {
            CHECKUP_NODE_VERSION: node,
            CHECKUP_PNPM_VERSION: pnpmPin,
            CHECKUP_PG_PORT: String(deadPort),
            CHECKUP_STORAGE_ROOT: storageRoot,
          },
          timeoutMs: 120_000,
        }),
      );

      expect(result.code, 'checkup must exit non-zero when a fact fails').not.toBe(0);
      expect(marker(result.all, 'postgres-5544'), `postgres-5544 must be marked FAIL:\n${result.all}`).toBe('FAIL');

      // not fail-fast: every other fact is still reported
      for (const fact of FACTS.filter((candidate) => candidate !== 'postgres-5544')) {
        expect(factLine(result.all, fact), `checkup stopped early — "${fact}" was not reported`).toBeTruthy();
      }
    },
    120_000,
  );
});
