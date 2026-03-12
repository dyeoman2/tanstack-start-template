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
  await userRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Impersonate user' }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(`You are impersonating ${userEmail}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop impersonating' })).toBeVisible();

  await page.getByRole('button', { name: 'Stop impersonating' }).click();

  await expect(page).toHaveURL(/\/app\/admin\/users(\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
  await expect(page.getByText(`You are impersonating ${userEmail}.`)).not.toBeVisible();
});

test('admin can ban and unban a user from the action menu', async ({ page }) => {
  const userEmail = getRequiredEnv('E2E_USER_EMAIL');

  await page.goto('/app/admin/users');
  const userRow = page.getByRole('row').filter({ hasText: userEmail });

  await userRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Ban user' }).click();
  await page.getByRole('button', { name: 'Ban user' }).click();

  await expect(userRow.getByText('Banned')).toBeVisible();

  await userRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Unban user' }).click();
  await page.getByRole('button', { name: 'Unban user' }).click();

  await expect(userRow.getByText('Banned')).not.toBeVisible();
});

test('admin can inspect sessions and revoke them', async ({ page }) => {
  const userEmail = getRequiredEnv('E2E_USER_EMAIL');

  await page.goto('/app/admin/users');
  const userRow = page.getByRole('row').filter({ hasText: userEmail });

  await userRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Manage sessions' }).click();

  await expect(page.getByRole('heading', { name: 'Manage sessions' })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke all sessions' }).click();
  await page.getByRole('button', { name: 'Confirm revoke all' }).click();

  await expect(page.getByText('All sessions revoked')).toBeVisible();
});

test('admin can reset a user password', async ({ page }) => {
  const userEmail = getRequiredEnv('E2E_USER_EMAIL');

  await page.goto('/app/admin/users');
  const userRow = page.getByRole('row').filter({ hasText: userEmail });

  await userRow.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Reset password' }).click();

  await page.getByLabel('New password').fill('AdminReset1!');
  await page.getByLabel('Confirm password').fill('AdminReset1!');
  await page.getByRole('button', { name: 'Reset password' }).click();

  await expect(page.getByText('Password updated')).toBeVisible();
});
