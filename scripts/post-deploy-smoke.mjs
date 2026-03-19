import { pathToFileURL } from 'node:url';

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
      'DEPLOY_SMOKE_BASE_URL or PRODUCTION_BASE_URL must be set for post-deploy smoke checks.',
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
    timeoutMs,
    pollIntervalMs,
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPayloadPreview(payload) {
  try {
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== 'string') {
      return String(payload);
    }

    return serialized.length > 300 ? `${serialized.slice(0, 300)}...` : serialized;
  } catch {
    return String(payload);
  }
}

function isAuthOkPayload(payload) {
  return payload?.status === 'ok' || payload?.ok === true;
}

async function expectJson(baseUrl, pathname, predicate, description) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let payloadPreview = '';
    try {
      const payload = await response.json();
      payloadPreview = `. Received: ${formatPayloadPreview(payload)}`;
    } catch {
      try {
        const text = await response.text();
        if (text) {
          payloadPreview = `. Received: ${text.length > 300 ? `${text.slice(0, 300)}...` : text}`;
        }
      } catch {
        // Ignore body parsing failures and fall back to the status-only error.
      }
    }

    throw new Error(`${pathname} returned ${response.status}${payloadPreview}`);
  }

  const payload = await response.json();
  if (!predicate(payload)) {
    throw new Error(
      `${pathname} failed validation: ${description}. Received: ${formatPayloadPreview(payload)}`,
    );
  }
}

async function expectHtml(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'GET',
    headers: {
      Accept: 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    throw new Error(`${pathname} did not return HTML`);
  }
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

export async function runPostDeploySmokeChecks(config = getConfigFromEnv()) {
  const { baseUrl, timeoutMs, pollIntervalMs } = config;

  await waitForCheck('GET /', () => expectHtml(baseUrl, '/'), timeoutMs, pollIntervalMs);
  await waitForCheck(
    'GET /api/auth/ok',
    () =>
      expectJson(
        baseUrl,
        '/api/auth/ok',
        isAuthOkPayload,
        'expected { status: "ok" } or { ok: true }',
      ),
    timeoutMs,
    pollIntervalMs,
  );
  await waitForCheck(
    'GET /api/health',
    () =>
      expectJson(
        baseUrl,
        '/api/health',
        (payload) => payload?.status === 'healthy',
        'expected { status: "healthy" }',
      ),
    timeoutMs,
    pollIntervalMs,
  );

  console.log(`Post-deploy smoke checks passed for ${baseUrl}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runPostDeploySmokeChecks();
}
