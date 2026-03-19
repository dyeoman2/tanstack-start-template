#!/usr/bin/env tsx

import process from 'node:process';
import { configureGitHubDeployEnvironments } from './lib/github-deploy-setup';

async function main() {
  console.log('GitHub deploy environment setup');
  console.log(
    'This configures the staging and production GitHub environments used by release.yml.',
  );
  console.log(
    'It also writes the repo-level CONVEX_DEPLOY_KEY required by existing compatibility workflows.',
  );

  const { repo } = await configureGitHubDeployEnvironments({});

  console.log('\nConfigured GitHub deploy environments:');
  console.log(`- repo: ${repo}`);
  console.log('- environments: staging, production');
  console.log(
    '- environment secrets: CONVEX_DEPLOY_KEY, NETLIFY_BUILD_HOOK_URL, NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID',
  );
  console.log('- environment variable: DEPLOY_SMOKE_BASE_URL');
  console.log('- repo secret: CONVEX_DEPLOY_KEY');
}

main().catch((error) => {
  console.error('\nFailed to configure GitHub deploy environments.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
