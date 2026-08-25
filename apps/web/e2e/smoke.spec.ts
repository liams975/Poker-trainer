import { expect, test } from '@playwright/test';

// Phase 0 proves the toolchain, not the product: the app builds, boots and
// serves a rendered page. Real user journeys arrive with the web shell.
test('the app boots and renders the shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Poker Trainer' })).toBeVisible();
});
