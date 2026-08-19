/**
 * AC-14: traces always, video only when something failed — read off the
 * artifacts directory, which is the only place the run leaves them.
 */
import { beforeAll, describe, expect, test } from 'vitest';

import { artifactFiles, clearArtifacts, ensureBrowsers, lane } from './support';

describe('AC-14 what a run leaves under var/e2e/artifacts', () => {
  beforeAll(() => {
    ensureBrowsers();
  });

  test('a passing J-000 run leaves a trace and no video', () => {
    clearArtifacts();
    const result = lane(['--journey', 'J-000']);
    expect(result.status, `pnpm e2e --journey J-000 failed:\n${result.output}`).toBe(0);

    const files = artifactFiles();
    expect(
      files.filter((file) => file.endsWith('trace.zip')),
      `no trace archive after a passing run:\n${files.join('\n')}`,
    ).not.toHaveLength(0);
    expect(
      files.filter((file) => file.endsWith('.webm')),
      `a passing test kept a video:\n${files.join('\n')}`,
    ).toHaveLength(0);
  });

  test('a failing breaker run leaves a video of the failure', () => {
    clearArtifacts();
    const result = lane(['--journey', 'J-SELF-AXE-FAIL']);
    expect(result.status, `the axe breaker journey was green:\n${result.output}`).not.toBe(0);

    const files = artifactFiles();
    expect(
      files.filter((file) => file.endsWith('.webm')),
      `no video for the failed test:\n${files.join('\n')}`,
    ).not.toHaveLength(0);
  });
});
