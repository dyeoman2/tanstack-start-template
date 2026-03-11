import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADMIN_AUTH_STATE_PATH, USER_AUTH_STATE_PATH } from './tests/e2e/support/storage-state';

const port = 3000;
const baseURL = `http://127.0.0.1:${port}`;

const loadEnvFile = process.loadEnvFile?.bind(process);

for (const fileName of ['.env', '.env.local']) {
  const filePath = resolve(process.cwd(), fileName);
  if (loadEnvFile && existsSync(filePath)) {
    loadEnvFile(filePath);
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm test:e2e:server',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'setup-auth',
      testMatch: /tests\/e2e\/setup\/.*\.setup\.ts/,
    },
    {
      name: 'chromium-public',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /tests\/e2e\/public\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-user',
      dependencies: ['setup-auth'],
      testMatch: /tests\/e2e\/authenticated\/user\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: USER_AUTH_STATE_PATH,
      },
    },
    {
      name: 'chromium-admin',
      dependencies: ['setup-auth'],
      testMatch: /tests\/e2e\/authenticated\/admin\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: ADMIN_AUTH_STATE_PATH,
      },
    },
  ],
});
