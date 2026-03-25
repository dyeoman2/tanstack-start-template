import { pathToFileURL } from 'node:url';

const REQUIRED_HARDENING_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

const REQUIRED_CACHE_CONTROL_BY_PATH = {
  '/': ['no-store', 'max-age=0'],
  '/register': ['no-store', 'max-age=0'],
  '/app/__security_probe__': ['no-store', 'max-age=0'],
};

const STRICT_TRANSPORT_SECURITY_VALUE = 'max-age=31536000; includeSubDomains; preload';

function getBaseUrlFromEnv(env = process.env) {
  return (env.DEPLOY_SMOKE_BASE_URL || env.PRODUCTION_BASE_URL || env.BETTER_AUTH_VERIFY_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function getConfigFromEnv(env = process.env) {
  const baseUrl = getBaseUrlFromEnv(env);
  const timeoutMs = Number.parseInt(env.DEPLOY_SMOKE_TIMEOUT_MS ?? '120000', 10);
  const pollIntervalMs = Number.parseInt(env.DEPLOY_SMOKE_POLL_INTERVAL_MS ?? '5000', 10);

  if (!baseUrl) {
    throw new Error(
      'DEPLOY_SMOKE_BASE_URL or PRODUCTION_BASE_URL must be set for post-deploy security checks.',
    );
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('DEPLOY_SMOKE_TIMEOUT_MS must be a positive integer');
  }

  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('DEPLOY_SMOKE_POLL_INTERVAL_MS must be a positive integer');
  }

  return {
    baseUrl,
    pollIntervalMs,
    timeoutMs,
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isHttpsUrl(url) {
  return new URL(url).protocol === 'https:';
}

function expectHeader(headers, pathname, headerName, expectedValue) {
  const actualValue = headers.get(headerName);
  if (actualValue !== expectedValue) {
    throw new Error(
      `${pathname} header ${headerName} mismatch. Expected "${expectedValue}", received "${actualValue ?? '<missing>'}"`,
    );
  }
}

function expectCacheControl(headers, pathname, expectedTokens) {
  const actualValue = headers.get('Cache-Control');
  if (!actualValue) {
    throw new Error(
      `${pathname} header Cache-Control mismatch. Expected tokens "${expectedTokens.join(', ')}", received "<missing>"`,
    );
  }

  const normalized = actualValue.toLowerCase();
  const missingToken = expectedTokens.find((token) => !normalized.includes(token.toLowerCase()));
  if (missingToken) {
    throw new Error(
      `${pathname} header Cache-Control mismatch. Missing token "${missingToken}" in "${actualValue}"`,
    );
  }
}

async function expectSecurityHeaders(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'GET',
    headers: {
      Accept: 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}`);
  }

  for (const [headerName, expectedValue] of Object.entries(REQUIRED_HARDENING_HEADERS)) {
    expectHeader(response.headers, pathname, headerName, expectedValue);
  }

  if (isHttpsUrl(baseUrl)) {
    expectHeader(
      response.headers,
      pathname,
      'Strict-Transport-Security',
      STRICT_TRANSPORT_SECURITY_VALUE,
    );
  }

  expectCacheControl(response.headers, pathname, REQUIRED_CACHE_CONTROL_BY_PATH[pathname]);
}

async function waitForCheck(label, check, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await check();
      console.log(`${label} passed`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = Math.max(timeoutMs - elapsedMs, 0);
      console.log(
        `${label} not ready yet: ${lastError.message} (${Math.ceil(remainingMs / 1000)}s remaining)`,
      );

      if (remainingMs <= 0) {
        break;
      }

      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  throw new Error(
    `${label} did not become ready within ${timeoutMs}ms. Last error: ${lastError?.message ?? 'Unknown error'}`,
  );
}

export async function runPostDeploySecurityChecks(config = getConfigFromEnv()) {
  const { baseUrl, timeoutMs, pollIntervalMs } = config;

  for (const pathname of Object.keys(REQUIRED_CACHE_CONTROL_BY_PATH)) {
    await waitForCheck(
      `GET ${pathname} security headers`,
      () => expectSecurityHeaders(baseUrl, pathname),
      timeoutMs,
      pollIntervalMs,
    );
  }

  console.log(`Post-deploy security checks passed for ${baseUrl}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runPostDeploySecurityChecks();
}
