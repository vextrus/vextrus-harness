/**
 * J-SELF — the harness proving itself.
 *
 * Every other journey is a statement about the product; this one is a statement
 * about the lane. If `checkpoint` stopped comparing baselines, or the mask
 * registry stopped being applied, or the mail helpers started returning nothing,
 * the product journeys would keep passing and the lane would quietly have become
 * a screenshot printer. So the self-test paints a deliberately volatile region —
 * a live clock, which changes every run and would fail the pixel compare unless
 * the J-SELF mask covers it — and writes a message into a temporary mail
 * directory to read it back through the exported helpers.
 *
 * It is a journey like any other and lives with them (Playwright's testDir is
 * tests/e2e/journeys); what makes it the *harness* self-test is its subject.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { checkpoint, journey, readMail, waitForMail } from '../harness/index';

/** A whole document, not a fragment: axe judges `<html lang>` and the title too. */
const SELF_TEST_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Harness self-test</title>
    <style>
      body { background: #ffffff; color: #111111; font-family: monospace; margin: 0; padding: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      .clock { background: #111111; color: #ffffff; display: inline-block; padding: 4px 8px; }
    </style>
  </head>
  <body>
    <main>
      <h1 data-testid="self-test-title">Harness self-test</h1>
      <p>The region below changes on every run and is masked for J-SELF.</p>
      <p class="clock" data-testid="volatile-clock">CLOCK</p>
    </main>
  </body>
</html>`;

journey('J-SELF', () => {
  test('checkpoint masks the volatile region and the mail helpers read a message', async ({
    page,
  }) => {
    const mailDir = mkdtempSync(join(tmpdir(), 'vextrus-e2e-mail-'));
    const message = {
      to: 'owner@e2e.vextrus.test',
      subject: 'Harness self-test',
      text: 'The lane can read the mail the dev mailer writes.',
    };
    writeFileSync(join(mailDir, '0001-self-test.json'), JSON.stringify(message));

    expect(await readMail(mailDir)).toEqual([message]);

    const waited = await waitForMail(
      { to: 'owner@e2e.vextrus.test', subject: /self-test/i },
      { dir: mailDir, timeoutMs: 5_000 },
    );
    expect(waited.text).toBe(message.text);

    await page.goto('/');
    await page.setContent(SELF_TEST_PAGE);
    // The clock is the volatility the mask exists for: a different string every
    // run, so an unmasked compare would go red and this journey would say so.
    await page.getByTestId('volatile-clock').evaluate((node) => {
      node.textContent = new Date().toISOString();
    });

    await expect(page.getByTestId('self-test-title')).toBeVisible();

    await checkpoint(page, 'self-test');
  });
});
