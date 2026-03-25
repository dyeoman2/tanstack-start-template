#!/usr/bin/env tsx

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, request } from '@playwright/test';
import { ensureE2EPrincipalProvisioned } from './lib/e2e-provision';
import { loadProjectEnvFiles } from './lib/load-project-env-files';

type Principal = 'user' | 'admin';

type Options = {
  baseUrl: string;
  headless: boolean;
  path: string;
  principal: Principal;
  screenshotPath?: string;
};

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
};

function loadLocalEnv() {
  loadProjectEnvFiles();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    baseUrl: 'http://127.0.0.1:3000',
    headless: true,
    path: '/app',
    principal: 'user',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--base-url') {
      options.baseUrl = argv[index + 1] || options.baseUrl;
      index += 1;
      continue;
    }

    if (arg === '--path') {
      options.path = argv[index + 1] || options.path;
      index += 1;
      continue;
    }

    if (arg === '--principal') {
      const principal = argv[index + 1];
      if (principal === 'user' || principal === 'admin') {
        options.principal = principal;
      }
      index += 1;
      continue;
    }

    if (arg === '--screenshot') {
      options.screenshotPath = argv[index + 1] || 'output/playwright/inspect.png';
      index += 1;
      continue;
    }

    if (arg === '--headed') {
      options.headless = false;
    }
  }

  return options;
}

function printUsage() {
  console.log(
    'Usage: pnpm run playwright:inspect -- [--base-url http://127.0.0.1:3000] [--path /app] [--principal user|admin] [--headed] [--screenshot output/playwright/inspect.png]',
  );
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run playwright:inspect -- --principal user --path /app');
  console.log(
    '- pnpm run playwright:inspect -- --principal admin --path /app/admin --screenshot output/playwright/admin.png',
  );
  console.log('');
  console.log(
    'What this does: authenticate with the repo auth route, open a page, and print a JSON summary.',
  );
  console.log('Safe to rerun: yes.');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  loadLocalEnv();
  console.log('🎭 Playwright inspect');
  console.log(
    'What this does: authenticate against /api/test/e2e-auth, load a page, optionally capture a screenshot, and print a compact JSON summary.',
  );
  console.log('Prereqs: local app reachable, ENABLE_E2E_TEST_AUTH=true, E2E_TEST_SECRET set.');
  console.log('Safe to rerun: yes.\n');

  if (process.env.ENABLE_E2E_TEST_AUTH !== 'true') {
    throw new Error('ENABLE_E2E_TEST_AUTH must be set to true');
  }

  const options = parseArgs(process.argv.slice(2));
  const secret = requireEnv('E2E_TEST_SECRET');
  const targetUrl = new URL(options.path, options.baseUrl).toString();

  const apiContext = await request.newContext({
    baseURL: options.baseUrl,
  });

  try {
    await ensureE2EPrincipalProvisioned({
      baseUrl: options.baseUrl,
      principal: options.principal,
    });

    const authResponse = await apiContext.post('/api/test/e2e-auth', {
      data: { principal: options.principal },
      headers: {
        'x-e2e-test-secret': secret,
      },
    });

    if (!authResponse.ok()) {
      throw new Error(`Auth route failed: ${authResponse.status()} ${await authResponse.text()}`);
    }

    const payload = (await authResponse.json()) as AuthRoutePayload;
    const browser = await chromium.launch({ headless: options.headless });

    try {
      const context = await browser.newContext();
      await context.addCookies(payload.cookies.map(({ path: _path, ...cookie }) => cookie));

      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: 'networkidle' });

      if (options.screenshotPath) {
        const screenshotPath = resolve(process.cwd(), options.screenshotPath);
        await mkdir(dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }

      const bodyText = await page.locator('body').innerText();
      const summary = {
        principal: options.principal,
        url: page.url(),
        title: await page.title(),
        sawAuthenticatedUser:
          bodyText.includes('e2e-user@local.test') || bodyText.includes('e2e-admin@local.test'),
        links: await page.getByRole('link').evaluateAll((elements) =>
          elements
            .map((element) => element.textContent?.trim() || '')
            .filter((text) => text.length > 0)
            .slice(0, 10),
        ),
        buttons: await page.getByRole('button').evaluateAll((elements) =>
          elements
            .map((element) => {
              const text = element.textContent?.trim();
              return text && text.length > 0 ? text : element.getAttribute('aria-label') || '';
            })
            .filter((text) => text.length > 0)
            .slice(0, 10),
        ),
        textPreview: bodyText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 20),
        screenshotPath: options.screenshotPath
          ? resolve(process.cwd(), options.screenshotPath)
          : null,
      };

      console.log(JSON.stringify(summary, null, 2));
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    await apiContext.dispose();
  }
}

main().catch((error) => {
  console.error('[playwright-inspect] Failed to inspect authenticated page');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
