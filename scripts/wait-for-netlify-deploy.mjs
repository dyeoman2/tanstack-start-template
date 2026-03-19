const authToken = process.env.NETLIFY_AUTH_TOKEN?.trim();
const siteId = process.env.NETLIFY_SITE_ID?.trim();
const deployCreatedAfter = Number.parseInt(process.env.NETLIFY_DEPLOY_CREATED_AFTER ?? '', 10);
const timeoutMs = Number.parseInt(process.env.NETLIFY_DEPLOY_TIMEOUT_MS ?? '900000', 10);
const pollIntervalMs = Number.parseInt(process.env.NETLIFY_DEPLOY_POLL_INTERVAL_MS ?? '10000', 10);

if (!authToken) {
  throw new Error('NETLIFY_AUTH_TOKEN is required');
}

if (!siteId) {
  throw new Error('NETLIFY_SITE_ID is required');
}

if (!Number.isFinite(deployCreatedAfter)) {
  throw new Error('NETLIFY_DEPLOY_CREATED_AFTER must be a unix timestamp in milliseconds');
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isTerminalState(state) {
  return state === 'ready' || state === 'error';
}

async function fetchLatestDeploy() {
  const response = await fetch(
    `https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Netlify deploy lookup failed with ${response.status}`);
  }

  const deploys = await response.json();
  if (!Array.isArray(deploys)) {
    throw new Error('Netlify deploy lookup returned an unexpected payload');
  }

  return (
    deploys.find((deploy) => {
      const createdAt =
        typeof deploy?.created_at === 'string' ? normalizeTimestamp(deploy.created_at) : null;
      return createdAt !== null && createdAt >= deployCreatedAfter;
    }) ?? null
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const deploy = await fetchLatestDeploy();

    if (!deploy) {
      console.log('Waiting for Netlify to create a deploy...');
      await sleep(pollIntervalMs);
      continue;
    }

    const state = typeof deploy.state === 'string' ? deploy.state : 'unknown';
    const url =
      typeof deploy.ssl_url === 'string' && deploy.ssl_url.length > 0
        ? deploy.ssl_url
        : typeof deploy.url === 'string'
          ? deploy.url
          : '';

    console.log(`Latest Netlify deploy ${deploy.id}: ${state}`);

    if (!isTerminalState(state)) {
      await sleep(pollIntervalMs);
      continue;
    }

    if (state !== 'ready') {
      throw new Error(`Netlify deploy ${deploy.id} finished in state "${state}"`);
    }

    if (url) {
      console.log(`Netlify deploy ready at ${url}`);
    }

    return;
  }

  throw new Error('Timed out waiting for Netlify deploy to become ready');
}

await main();
