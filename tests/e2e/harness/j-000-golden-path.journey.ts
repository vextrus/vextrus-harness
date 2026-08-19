/**
 * J-000, the Golden Path — as much of it as the product can do today.
 *
 * The Bible's J-000 runs from sign-up to a signed BOQ and grows a step per
 * milestone. In M0 the product is a scaffold with one screen, so the journey is
 * that screen: load it, see the app, checkpoint it. Q-03 says "J-000 always",
 * and a journey that does not exist until M5 cannot be run on every merge — this
 * is the same journey, at its current length.
 */
import { expect, test } from '@playwright/test';

import { checkpoint, journey } from './index';

journey('J-000', () => {
  test('the app answers on 3211 and shows its name', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('app-title')).toBeVisible();

    await checkpoint(page, 'home');
  });
});
