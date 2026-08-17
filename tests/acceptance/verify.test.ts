// V-VERIFY / Q-01 — `pnpm verify` is the whole contract: ordered stages,
// fail-fast, exit code, printed wall time.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { pnpm, repoRoot, sawStage, stageIndex } from '../support/run';
import { RULE_ID, TOKEN_TS_IGNORE } from '../support/tokens';

const STAGES = ['typegen', 'tsc', 'eslint', 'vitest', 'build'] as const;
const SCRATCH_DIR = join(repoRoot(), 'src', '__acceptance_scratch__');
const VERIFY_TIMEOUT_MS = 300_000;

function withScratchFile(fileName: string, contents: string, body: (output: string, code: number) => void): void {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const path = join(SCRATCH_DIR, fileName);
  writeFileSync(path, contents, 'utf8');
  try {
    const result = pnpm(['verify'], {}, VERIFY_TIMEOUT_MS);
    body(result.output, result.code);
  } finally {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  }
}

describe.sequential('pnpm verify', () => {
  it('exits 0 and prints the five stage names in order with a total wall time', () => {
    // AC-01 / V-VERIFY — checkpoint `verify-green`.
    const result = pnpm(['verify'], {}, VERIFY_TIMEOUT_MS);
    expect(result.code, `verify failed:\n${result.output}`).toBe(0);

    for (const stage of STAGES) {
      expect(sawStage(result.output, stage), `stage "${stage}" never printed`).toBe(true);
    }
    const positions = STAGES.map((stage) => stageIndex(result.output, stage));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // AC-01 — wall time line.
    expect(result.output).toMatch(/total\s+\d+(\.\d+)?s/);
  }, VERIFY_TIMEOUT_MS);

  it('stops at the tsc stage on a type error and never reaches eslint, vitest or build', () => {
    // AC-04 / V-VERIFY fail-fast.
    withScratchFile('ac04-type-error.ts', 'export const broken: number = "not a number";\n', (output, code) => {
      expect(code, `expected a non-zero exit:\n${output}`).not.toBe(0);
      expect(sawStage(output, 'tsc'), 'tsc stage should have run').toBe(true);
      for (const stage of ['eslint', 'vitest', 'build']) {
        expect(sawStage(output, stage), `stage "${stage}" ran after a tsc failure:\n${output}`).toBe(false);
      }
    });
  }, VERIFY_TIMEOUT_MS);

  it('stops at the eslint stage on a forbidden escape and names the rule id', () => {
    // AC-05 / Q-08 — the escape token is written by concatenation (AC-13).
    const contents = `// ${TOKEN_TS_IGNORE}\nexport const scratch = 1;\n`;
    withScratchFile('ac05-forbidden-escape.ts', contents, (output, code) => {
      expect(code, `expected a non-zero exit:\n${output}`).not.toBe(0);
      expect(sawStage(output, 'eslint'), 'eslint stage should have run').toBe(true);
      expect(output, 'eslint output must name the rule id').toContain(RULE_ID);
      for (const stage of ['vitest', 'build']) {
        expect(sawStage(output, stage), `stage "${stage}" ran after an eslint failure:\n${output}`).toBe(false);
      }
    });
  }, VERIFY_TIMEOUT_MS);

  it('can run a single stage in isolation via VERIFY_ONLY', () => {
    // Interface contract — VERIFY_ONLY=<prefix> runs one stage for debugging.
    const result = pnpm(['verify'], { VERIFY_ONLY: 'tsc' }, VERIFY_TIMEOUT_MS);
    expect(result.code, `VERIFY_ONLY=tsc failed:\n${result.output}`).toBe(0);
    expect(sawStage(result.output, 'tsc')).toBe(true);
    expect(sawStage(result.output, 'build'), 'VERIFY_ONLY must not run other stages').toBe(false);
  }, VERIFY_TIMEOUT_MS);
});
