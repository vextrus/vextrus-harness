import { afterEach, describe, expect, it } from 'vitest';
import { TOKEN, VERIFY_STAGES, injectFile, pnpm, removeDir, stageAt, stageRan } from './harness';

const SCRATCH_DIR = 'src/scratch-accept';
let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  removeDir(SCRATCH_DIR);
});

describe('journey: verify-green (V-VERIFY, Q-01, B-03)', () => {
  it('[checkpoint: verify-green] AC-01 — pnpm install --frozen-lockfile succeeds', () => {
    const result = pnpm(['install', '--frozen-lockfile'], { timeoutMs: 300_000 });
    expect(result.timedOut).toBe(false);
    expect(result.status, result.output).toBe(0);
  });

  it('[checkpoint: verify-green] AC-01 — pnpm verify exits 0, prints five stages in order and a total wall time', () => {
    const result = pnpm(['verify'], { timeoutMs: 300_000 });
    expect(result.timedOut).toBe(false);
    expect(result.status, result.output).toBe(0);

    // V-VERIFY: typegen → tsc → eslint → vitest → build, in that order.
    const offsets: number[] = [];
    for (const stage of VERIFY_STAGES) {
      const at = stageAt(result.output, stage);
      expect(at, `stage "${stage}" was never announced on its own line:\n${result.output}`).toBeGreaterThanOrEqual(0);
      offsets.push(at);
    }
    const sorted = [...offsets].sort((a, b) => a - b);
    expect(offsets).toEqual(sorted);

    // V-VERIFY: "wall time printed".
    expect(result.output).toMatch(/total\s+\d+(\.\d+)?s/);
  });
});

describe('AC-04 — fail-fast at the tsc stage', () => {
  it('a type error under src/ stops verify at tsc; eslint, vitest and build never announce', () => {
    cleanup = injectFile(
      `${SCRATCH_DIR}/ac04-type-error.ts`,
      'export const deliberate: number = "not a number";\n',
    );
    const result = pnpm(['verify'], { timeoutMs: 300_000 });

    expect(result.timedOut).toBe(false);
    expect(result.status, result.output).not.toBe(0);
    expect(stageRan(result.output, 'tsc')).toBe(true);
    // Fail-fast is observable only through stage-name absence.
    expect(stageRan(result.output, 'eslint'), result.output).toBe(false);
    expect(stageRan(result.output, 'vitest'), result.output).toBe(false);
    expect(stageRan(result.output, 'build'), result.output).toBe(false);
  });
});

describe('AC-05 — fail-fast at the eslint stage on a Q-08 forbidden escape', () => {
  it('a file carrying a suppression comment and an unspecified type annotation fails eslint by rule id', () => {
    // Tokens are constructed (AC-13) so this suite's own source stays lint-clean.
    const source = [
      `// ${TOKEN.tsIgnore}`,
      `export const escaped: ${TOKEN.anyType} = 1;`,
      '',
    ].join('\n');
    cleanup = injectFile(`${SCRATCH_DIR}/ac05-escapes.ts`, source);

    const result = pnpm(['verify'], { timeoutMs: 300_000 });

    expect(result.timedOut).toBe(false);
    expect(result.status, result.output).not.toBe(0);
    expect(stageRan(result.output, 'eslint')).toBe(true);
    expect(result.output).toContain('vextrus/no-forbidden-escapes');
    // Q-01 fail-fast: the remaining stages must not have run.
    expect(stageRan(result.output, 'vitest'), result.output).toBe(false);
    expect(stageRan(result.output, 'build'), result.output).toBe(false);
  });
});

describe('AC-05 — a disable directive cannot switch off its own detector (Q-08)', () => {
  it('a file whose only escape is a blanket lint-disable comment still fails the eslint stage', () => {
    const source = [`/* ${TOKEN.eslintDisable} */`, 'export const suppressed = 1;', ''].join('\n');
    cleanup = injectFile(`${SCRATCH_DIR}/ac05-disable.ts`, source);

    const result = pnpm(['verify'], { timeoutMs: 300_000 });

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('vextrus/no-forbidden-escapes');
  });
});
