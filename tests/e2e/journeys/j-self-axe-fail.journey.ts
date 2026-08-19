/**
 * J-SELF-AXE-FAIL — the breaker that proves Q-11 has teeth.
 *
 * A green axe scan is only evidence if a red one is possible. This journey puts
 * text on the page that nobody can read (contrast far below WCAG AA, which axe
 * reports as `serious`) and takes it through the same `checkpoint()` every real
 * journey uses. If it ever passes, the accessibility gate has stopped gating.
 *
 * It is tagged `@breaker`, and the lane grep-inverts that tag: `pnpm e2e` stays
 * green, while `pnpm e2e --journey J-SELF-AXE-FAIL` selects it on purpose and
 * must go red.
 */
import { test } from '@playwright/test';

import { checkpoint, journey } from '../harness/index';

const UNREADABLE_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Axe breaker</title>
  </head>
  <body style="background: #ffffff">
    <main>
      <h1 style="color: #eeeeee; background: #ffffff; font-size: 18px">
        This heading fails WCAG contrast on purpose
      </h1>
      <p style="color: #f2f2f2; background: #ffffff">And so does this paragraph.</p>
    </main>
  </body>
</html>`;

journey(
  'J-SELF-AXE-FAIL',
  () => {
    test('a serious contrast violation fails the checkpoint', async ({ page }) => {
      await page.goto('/');
      await page.setContent(UNREADABLE_PAGE);

      await checkpoint(page, 'unreadable');
    });
  },
  { breaker: true },
);
