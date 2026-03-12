import { expect, test } from '@playwright/test';
import { getRequiredEnv } from '../support/env';

test('admin can load the admin dashboard and stats', async ({ page }) => {
  await page.goto('/app/admin');
  await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({
    timeout: 15_000,
  });

  await page.goto('/app/admin/stats');
  await expect(page.getByRole('heading', { name: 'System Statistics' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/total users/i)).toBeVisible();
});

test('admin user management can find the seeded e2e user', async ({ page }) => {
  await page.goto('/app/admin/users');

  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
  await expect(page.getByText(getRequiredEnv('E2E_USER_EMAIL'))).toBeVisible();
  await expect(page.getByRole('textbox', { name: /search users by name or email/i })).toBeVisible();
});

test('admin can impersonate a user and return to admin mode', async ({ page }) => {
  const userEmail = getRequiredEnv('E2E_USER_EMAIL');

  await page.goto('/app/admin/users');
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();

  const userRow = page.getByRole('row').filter({ hasText: userEmail });
  await expect(userRow).toBeVisible();
  await userRow.getByRole('button', { name: 'Impersonate' }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(`You are impersonating ${userEmail}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop impersonating' })).toBeVisible();

  await page.getByRole('button', { name: 'Stop impersonating' }).click();

  await expect(page).toHaveURL(/\/app\/admin\/users(\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
  await expect(page.getByText(`You are impersonating ${userEmail}.`)).not.toBeVisible();
});
