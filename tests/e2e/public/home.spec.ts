import { expect, test } from '@playwright/test';

test('marketing home renders key CTA content', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      name: /a production-ready starter template for tanstack start/i,
    }),
  ).toBeVisible();

  await expect(page.getByRole('link', { name: /explore the demo/i })).toHaveAttribute(
    'href',
    '/register',
  );

  await expect(page.getByRole('link', { name: /view on github/i })).toBeVisible();
});
