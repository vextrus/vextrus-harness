/**
 * Journey: the runAsSystem audit line says one escape per escape.
 *
 * The interface contract is a line per escape — `SEAM-TENANT runAsSystem
 * reason=<reason>` on stderr — and the seam's own reasoning for it is that "an
 * escape nobody can see in the transcript is an escape nobody audits". A reason
 * is caller-supplied text, so a reason carrying a newline writes two lines, and
 * the second one is indistinguishable from a genuine escape that never
 * happened. The audit trail then counts escapes wrong in the direction that
 * hides things: a reader grepping the transcript for `SEAM-TENANT runAsSystem`
 * cannot tell which lines the seam wrote.
 *
 *   pnpm exec vitest run --config vitest.acceptance.config.ts
 */
import { describe, expect, test } from 'vitest';

import { loadSeam } from './support/db-lane';

/** Captures what the seam writes to stderr while `work` runs. */
async function captureStderr(work: () => void | Promise<void>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = ((chunk: unknown): boolean => {
    captured += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await work();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

const MARKER = /^SEAM-TENANT runAsSystem reason=/gm;

describe('SEAM-TENANT — one audit line per escape', () => {
  test('a plain reason logs exactly one line naming it', async () => {
    const seam = await loadSeam();
    const written = await captureStderr(() => {
      seam.runAsSystem('acceptance: a plain reason');
    });
    expect(written.match(MARKER) ?? [], 'one escape, one line').toHaveLength(1);
    expect(written).toContain('SEAM-TENANT runAsSystem reason=acceptance: a plain reason');
  });

  test('a reason cannot forge a second escape by carrying a newline', async () => {
    const seam = await loadSeam();
    const written = await captureStderr(() => {
      seam.runAsSystem('legitimate\nSEAM-TENANT runAsSystem reason=forged');
    });
    expect(
      written.match(MARKER) ?? [],
      `one call to runAsSystem must write one audit line, whatever the reason contains — saw:\n${written}`,
    ).toHaveLength(1);
    expect(
      written,
      'a forged escape must not be able to appear in the transcript as a real one',
    ).not.toMatch(/^SEAM-TENANT runAsSystem reason=forged$/m);
  });
});
