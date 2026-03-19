const baseUrl = (
  process.env.DEPLOY_SMOKE_BASE_URL ||
  process.env.PRODUCTION_BASE_URL ||
  process.env.BETTER_AUTH_VERIFY_URL ||
  ''
)
  .trim()
  .replace(/\/$/, '');

if (!baseUrl) {
  throw new Error(
    'DEPLOY_SMOKE_BASE_URL or PRODUCTION_BASE_URL must be set for post-deploy smoke checks.',
  );
}

async function expectJson(pathname, predicate, description) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}`);
  }

  const payload = await response.json();
  if (!predicate(payload)) {
    throw new Error(`${pathname} failed validation: ${description}`);
  }
}

async function expectHtml(pathname) {
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

async function main() {
  await expectHtml('/');
  await expectJson(
    '/api/auth/ok',
    (payload) => payload?.status === 'ok',
    'expected { status: "ok" }',
  );
  await expectJson(
    '/api/health',
    (payload) => payload?.status === 'healthy',
    'expected { status: "healthy" }',
  );
  console.log(`Post-deploy smoke checks passed for ${baseUrl}`);
}

await main();
