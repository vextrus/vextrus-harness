/**
 * Fixture test for the `env` fact (V-CHECKUP: env; AC-02/AC-03).
 *
 * At M0 the required set is empty — the app is a titled page with no database,
 * no worker and no secrets — so on a real machine this fact cannot go red. A
 * fact that cannot fail is not a report, so two things have to be true and are
 * checked here: the line says it checked nothing rather than implying a healthy
 * environment, and the path that does fail is real code, not a claim, so the
 * increment that adds `DATABASE_URL` to the list gets a red fact for free.
 *
 * TypeScript, and under `tests/`, on purpose: `pnpm test` must execute only the
 * extensions the Q-08 guardrail lints (`**\/*.ts`, `**\/*.tsx`). A `.mjs` test
 * file would be a file the runner executes and `vextrus/no-forbidden-escapes`
 * cannot see — a `.only` in it would shrink the suite with verify still green.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fact = join(repoRoot, 'scripts', 'checkup.d', '40-ports-env.mjs');

/** Runs the fact file and returns the `env` line it printed. */
function envLine(env: Record<string, string>): { line: string; stdout: string } {
  const result = spawnSync(process.execPath, [fact], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  const stdout = result.stdout ?? '';
  const line = stdout.split('\n').find((entry) => /^(ok|FAIL)\s+env\b/.test(entry));
  return { line: line ?? '', stdout };
}

describe('the env fact', () => {
  test('says it checked nothing rather than implying a configured machine', () => {
    const { line, stdout } = envLine({ CHECKUP_REQUIRED_ENV: '' });

    expect(line, stdout).toMatch(/^ok env — /);
    expect(line).toMatch(/nothing checked/);
  });

  test('names the variable it is missing, and fails on it', () => {
    const name = 'VEXTRUS_ENV_FACT_PROBE';
    const { line, stdout } = envLine({ CHECKUP_REQUIRED_ENV: name, [name]: '' });

    expect(line, stdout).toMatch(new RegExp(`^FAIL env — missing ${name}$`));
  });

  test('goes green again once that variable is set, and says which it checked', () => {
    const name = 'VEXTRUS_ENV_FACT_PROBE';
    const { line, stdout } = envLine({ CHECKUP_REQUIRED_ENV: name, [name]: 'present' });

    expect(line, stdout).toMatch(new RegExp(`^ok env — .*${name}`));
  });
});
