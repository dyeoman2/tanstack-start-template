import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { APIRequestContext, Browser, BrowserContext } from '@playwright/test';
import { getRequiredEnv } from './env';

type Principal = 'user' | 'admin';

type AuthRouteCookie = {
  expires?: number;
  httpOnly?: boolean;
  name: string;
  path?: string;
  sameSite?: 'Lax' | 'None' | 'Strict';
  secure?: boolean;
  url: string;
  value: string;
};

type AuthRoutePayload = {
  cookies: AuthRouteCookie[];
  email: string;
  principal: Principal;
  userId: string;
};

async function createAuthenticatedContext(
  browser: Browser,
  cookies: AuthRouteCookie[],
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies(
    cookies.map(({ path: _path, ...cookie }) => cookie),
  );
  return context;
}

export async function createStorageStateForPrincipal({
  baseURL,
  browser,
  principal,
  request,
  storageStatePath,
}: {
  baseURL: string;
  browser: Browser;
  principal: Principal;
  request: APIRequestContext;
  storageStatePath: string;
}) {
  const response = await request.post('/api/test/e2e-auth', {
    data: { principal },
    headers: {
      'x-e2e-test-secret': getRequiredEnv('E2E_TEST_SECRET'),
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to provision ${principal} auth state: ${await response.text()}`);
  }

  const payload = (await response.json()) as AuthRoutePayload;
  const context = await createAuthenticatedContext(browser, payload.cookies);
  const page = await context.newPage();

  await page.goto(baseURL);
  await mkdir(dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  await context.close();

  return payload;
}
