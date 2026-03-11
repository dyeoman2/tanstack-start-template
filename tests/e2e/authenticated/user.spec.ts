import { expect, test } from '@playwright/test';
import { getRequiredEnv } from '../support/env';

test('authenticated user can load the app dashboard and profile', async ({ page }) => {
  await page.goto('/app');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(/limited access/i)).toBeVisible();

  await page.goto('/app/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toHaveValue(getRequiredEnv('E2E_USER_EMAIL'));
});

test('non-admin user cannot access admin-only data routes', async ({ page }) => {
  await page.goto('/app/admin/stats');

  await expect(page).toHaveURL(/\/app\/admin\/stats/);
  await expect(page.getByText('Admin Panel Unavailable')).toBeVisible();
});
