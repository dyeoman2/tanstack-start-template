const authToken = process.env.NETLIFY_AUTH_TOKEN?.trim();
const siteId = process.env.NETLIFY_SITE_ID?.trim();
const deployCreatedAfter = Number.parseInt(process.env.NETLIFY_DEPLOY_CREATED_AFTER ?? '', 10);
const expectedBranch = process.env.NETLIFY_EXPECTED_BRANCH?.trim() || null;
const expectedGitSha = process.env.NETLIFY_EXPECTED_GIT_SHA?.trim().toLowerCase() || null;
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

function normalizeGitSha(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/u.test(trimmed) ? trimmed : null;
}

function extractDeployGitSha(deploy) {
  const directCandidates = [
    deploy?.commit_ref,
    deploy?.sha,
    deploy?.commit?.sha,
    deploy?.links?.commit,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeGitSha(candidate);
    if (normalized) {
      return normalized;
    }
  }

  if (typeof deploy?.commit_url === 'string') {
    const match = deploy.commit_url.match(/\/commit\/([0-9a-f]{7,40})$/iu);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function extractDeployBranch(deploy) {
  const candidates = [deploy?.branch, deploy?.context];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function matchesExpectedGitSha(deployGitSha) {
  if (!expectedGitSha) {
    return true;
  }

  if (!deployGitSha) {
    return false;
  }

  return expectedGitSha === deployGitSha || expectedGitSha.startsWith(deployGitSha);
}

function matchesExpectedBranch(deployBranch) {
  if (!expectedBranch) {
    return true;
  }

  return deployBranch === expectedBranch;
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
      if (createdAt === null || createdAt < deployCreatedAfter) {
        return false;
      }

      const deployBranch = extractDeployBranch(deploy);
      if (!matchesExpectedBranch(deployBranch)) {
        return false;
      }

      const deployGitSha = extractDeployGitSha(deploy);
      return matchesExpectedGitSha(deployGitSha);
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
    const deployBranch = extractDeployBranch(deploy);
    const deployGitSha = extractDeployGitSha(deploy);
    const url =
      typeof deploy.ssl_url === 'string' && deploy.ssl_url.length > 0
        ? deploy.ssl_url
        : typeof deploy.url === 'string'
          ? deploy.url
          : '';

    console.log(`Latest Netlify deploy ${deploy.id}: ${state}`);
    if (deployBranch) {
      console.log(`Netlify deploy branch: ${deployBranch}`);
    }
    if (deployGitSha) {
      console.log(`Netlify deploy git SHA: ${deployGitSha}`);
    }

    if (!isTerminalState(state)) {
      await sleep(pollIntervalMs);
      continue;
    }

    if (state !== 'ready') {
      throw new Error(`Netlify deploy ${deploy.id} finished in state "${state}"`);
    }

    if (expectedGitSha && !deployGitSha) {
      throw new Error(
        `Netlify deploy ${deploy.id} became ready, but its metadata did not expose a commit SHA to verify against ${expectedGitSha}`,
      );
    }

    if (url) {
      console.log(`Netlify deploy ready at ${url}`);
    }

    return;
  }

  throw new Error('Timed out waiting for Netlify deploy to become ready');
}

await main();
