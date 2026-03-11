import { test as setup } from '@playwright/test';
import { createStorageStateForPrincipal } from '../support/e2e-auth';
import { ADMIN_AUTH_STATE_PATH, USER_AUTH_STATE_PATH } from '../support/storage-state';

setup('create user and admin auth storage states', async ({ baseURL, browser, request }) => {
  if (!baseURL) {
    throw new Error('Playwright baseURL is required for auth setup');
  }

  await createStorageStateForPrincipal({
    baseURL,
    browser,
    principal: 'user',
    request,
    storageStatePath: USER_AUTH_STATE_PATH,
  });

  await createStorageStateForPrincipal({
    baseURL,
    browser,
    principal: 'admin',
    request,
    storageStatePath: ADMIN_AUTH_STATE_PATH,
  });
});
