#!/usr/bin/env tsx

import process from 'node:process';
import {
  CLI_INSTALL_HINT,
  commandOnPath,
  findMissingCommands,
  requireCommands,
} from './lib/cli-preflight';
import { configureGitHubDeployEnvironments } from './lib/github-deploy-setup';

function printMissingCliSummary(
  title: string,
  missing: ReadonlyArray<{ cmd: string; hint: string }>,
) {
  if (missing.length === 0) {
    return;
  }

  console.log(`\n${title}`);
  for (const item of missing) {
    console.log(`- ${item.cmd}: ${item.hint}`);
  }
}

function printUsage() {
  console.log('Usage: pnpm run setup:github-deploy');
  console.log('');
  console.log(
    'What this does: configure deploy.yml GitHub environments for staging and production.',
  );
  console.log('');
  console.log('Prereqs:');
  console.log('- git and gh on PATH');
  console.log('- gh authenticated with permission to manage repo environments and secrets');
  console.log('- Netlify auth token/site access available during prompts');
  console.log('');
  console.log('Safe to rerun: yes; it updates the existing environment config.');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const requiredMissing = findMissingCommands([{ cmd: 'git' }, { cmd: 'gh' }]);
  if (requiredMissing.length > 0) {
    printMissingCliSummary('Missing required CLIs', requiredMissing);
    process.exit(1);
  }
  console.log('Provider preflight:');
  console.log('- GitHub CLI: installed');
  console.log('- GitHub auth: run `gh auth login` if environment/secret updates fail');
  if (!commandOnPath('netlify')) {
    console.log(`- Netlify CLI (optional auto-detect): ${CLI_INSTALL_HINT.netlify}`);
  } else {
    console.log('- Netlify CLI (optional auto-detect): installed');
  }
  console.log('');
  requireCommands([{ cmd: 'git' }, { cmd: 'gh' }]);
  console.log('GitHub deploy environment setup');
  console.log('This configures the staging and production GitHub environments used by deploy.yml.');
  console.log('It also writes the repo-level CONVEX_DEPLOY_KEY required by the deploy workflows.');
  console.log(
    'Treat the production environment and CONVEX_DEPLOY_KEY as the same secret-tier approval lane.',
  );
  console.log('Safe to rerun: yes; existing environment values can be refreshed.\n');

  const { repo } = await configureGitHubDeployEnvironments({});

  console.log('\nConfigured GitHub deploy environments:');
  console.log(`- repo: ${repo}`);
  console.log('- environments: staging, production');
  console.log(
    '- environment secrets: CONVEX_DEPLOY_KEY, NETLIFY_BUILD_HOOK_URL, NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID',
  );
  console.log('- environment variable: DEPLOY_SMOKE_BASE_URL');
  console.log('- repo secret: CONVEX_DEPLOY_KEY');
  console.log(
    '- recommended: require reviewers on the production GitHub environment before deploy jobs run',
  );
}

main().catch((error) => {
  console.error('\nFailed to configure GitHub deploy environments.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
