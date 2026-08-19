/**
 * The cad lane's whole-run proofs (AC-01, AC-05).
 *
 * Named `*.e2e.ts` on purpose: these shell out to `pnpm verify` — whose vitest
 * stage runs the repo's `*.test.*`/`*.spec.*` files — and to `pnpm gen:fixtures`,
 * which rewrites the tree. Run with:
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { describe, expect, test } from 'vitest';

import { runCli } from '../acceptance/support/cli';

/** The line a stage announces itself with, anchored — prose that names it is not it. */
const MARKER = /^==\s+stage\s+([a-z0-9-]+)\s+==$/;

function stageLineIndex(output: string, stage: string): number {
  return output.split('\n').findIndex((line) => MARKER.exec(line.trim())?.[1] === stage);
}

const verify = (): ReturnType<typeof runCli> => runCli('pnpm', ['verify'], {}, 1_800_000);

describe('AC-01 — the cad stage runs inside a green verify, in its place', () => {
  test('pnpm verify exits 0 and announces cad between db-drift and build', () => {
    const result = verify();

    expect(result.status, result.output).toBe(0);

    const dbDrift = stageLineIndex(result.output, 'db-drift');
    const cad = stageLineIndex(result.output, 'cad');
    const build = stageLineIndex(result.output, 'build');

    expect(cad, '`== stage cad ==` must be printed').toBeGreaterThanOrEqual(0);
    expect(dbDrift, '`== stage db-drift ==` must be printed').toBeGreaterThanOrEqual(0);
    expect(build, '`== stage build ==` must be printed').toBeGreaterThanOrEqual(0);
    expect(cad, 'cad runs after db-drift').toBeGreaterThan(dbDrift);
    expect(cad, 'cad runs before build').toBeLessThan(build);
  }, 1_800_000);

  test('the closing total breakdown names cad among the stages that ran', () => {
    // AC-01: V-VERIFY — wall time printed, and the breakdown names the stages.
    const result = verify();

    const total = result.output.split('\n').find((line) => line.startsWith('total '));
    expect(total, result.output).toBeDefined();
    expect(total ?? '').toMatch(/^total \d+(\.\d+)?s \(.*\bcad \d+(\.\d+)?s.*\)$/);
  }, 1_800_000);
});

describe('AC-05 — pnpm gen:fixtures rewrites the manifest and is byte-idempotent', () => {
  test('two runs leave the fixtures tree untouched', () => {
    // L-CAD-09: fixtures are authored by committed scripts — so regenerating
    // them must produce the committed bytes, or the scripts are not the source
    // of truth they claim to be (risk note 3: ezdxf GUIDs, reportlab invariant).
    const first = runCli('pnpm', ['gen:fixtures'], {}, 1_800_000);
    expect(first.status, first.output).toBe(0);
    expect(first.stdout, first.output).toMatch(/^wrote fixtures\/MANIFEST\.json/m);

    const second = runCli('pnpm', ['gen:fixtures'], {}, 1_800_000);
    expect(second.status, second.output).toBe(0);
    expect(second.stdout).toMatch(/^wrote fixtures\/MANIFEST\.json \(\d+ fixtures\)$/m);

    const status = runCli('git', ['status', '--porcelain', '--', 'fixtures'], {}, 120_000);
    expect(status.stdout.trim(), 'regeneration must not change the tree').toBe('');
  }, 1_800_000);
});
