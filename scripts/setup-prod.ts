#!/usr/bin/env tsx

/**
 * Production deployment setup script.
 * Handles complete production setup including Convex bootstrap and GitHub deploy env setup.
 * Run: pnpm run setup:prod
 */

import { execSync } from 'node:child_process';
import process from 'node:process';
import {
  askInput,
  askYesNo,
  configureGitHubDeployEnvironments,
  normalizeUrl,
  promptForProductionConvexDeployKey,
} from './lib/github-deploy-setup';
import { DEFAULT_APP_NAME, DEFAULT_PROD_RESEND_SENDER } from './lib/setup-defaults';

async function setupConvexProduction(): Promise<{
  betterAuthSecret: string;
  convexSiteUrl: string;
  convexUrl: string;
  deploymentName: string;
  deployOutput: string;
} | null> {
  console.log('\n🚀 Setting up Convex production...');

  const betterAuthSecret = execSync('openssl rand -base64 32', { encoding: 'utf8' }).trim();

  console.log('\n⚙️  Setting production environment variables...');

  const prodEnvVars = [
    { name: 'BETTER_AUTH_SECRET', value: betterAuthSecret },
    { name: 'APP_NAME', value: DEFAULT_APP_NAME },
    { name: 'RESEND_EMAIL_SENDER', value: DEFAULT_PROD_RESEND_SENDER },
  ];

  for (const { name, value } of prodEnvVars) {
    try {
      console.log(`   Setting ${name}...`);
      execSync(`npx convex env set ${name} "${value}" --prod`, {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
    } catch {
      console.log(`   ⚠️  Failed to set ${name} (may already be set or you may not have access)`);
    }
  }

  console.log('\n🚀 Deploying to Convex production...');
  try {
    const deployOutput = execSync('npx convex deploy --yes 2>&1', {
      encoding: 'utf8',
      cwd: process.cwd(),
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    console.log('✅ Convex production deployment complete!\n', deployOutput);

    const urlIndex = deployOutput.indexOf('https://');
    if (urlIndex !== -1) {
      const urlStart = deployOutput.slice(urlIndex);
      const urlEnd = urlStart.indexOf('\n') !== -1 ? urlStart.indexOf('\n') : urlStart.length;
      const url = urlStart.slice(0, urlEnd).trim();
      const deploymentMatch = url.match(/https:\/\/([a-z0-9-]+)\.convex\.cloud/);
      if (deploymentMatch?.[1]) {
        const deploymentName = deploymentMatch[1];
        const convexUrl = `https://${deploymentName}.convex.cloud`;
        return {
          betterAuthSecret,
          convexSiteUrl: `${convexUrl.replace('.convex.cloud', '.convex.site')}`,
          convexUrl,
          deploymentName,
          deployOutput,
        };
      }
    }

    return null;
  } catch {
    console.log('❌ Convex deployment failed. You can try again later with: npx convex deploy');
    console.log('   Make sure you have the correct permissions and environment variables set.');
    throw new Error('Convex deployment failed');
  }
}

function getRepositoryUrl() {
  try {
    const gitRemote = execSync('git config --get remote.origin.url', {
      encoding: 'utf8',
      cwd: process.cwd(),
    }).trim();

    if (gitRemote.startsWith('git@')) {
      return gitRemote.replace('git@github.com:', 'https://github.com/').replace('.git', '');
    }

    if (gitRemote.startsWith('https://')) {
      return gitRemote.replace('.git', '');
    }
  } catch {
    // Fall through.
  }

  return 'your GitHub repository URL';
}

function getExistingProdBetterAuthUrl() {
  try {
    return execSync('npx convex env get BETTER_AUTH_URL --prod', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function main() {
  try {
    const shouldContinue = await askYesNo('Ready to set up production deployment?', false);
    if (!shouldContinue) {
      console.log('👋 Setup cancelled.');
      return;
    }

    const convexInfo = await setupConvexProduction();
    if (!convexInfo) {
      console.log(
        '⚠️  Could not determine Convex deployment information. Continuing with manual setup...',
      );
    }

    console.log('\n🔐 Production deploy key setup');
    console.log(
      'CONVEX_DEPLOY_KEY is required for production deploys, CI/CD, and compatibility workflows.',
    );
    const productionConvexDeployKey = await promptForProductionConvexDeployKey(
      process.env.CONVEX_DEPLOY_KEY?.trim() || null,
    );

    console.log('\n🌐 Netlify Deployment Setup');
    console.log('────────────────────────────');
    console.log('📋 Make sure your production Netlify site exists before continuing.');
    console.log(
      `1. Open ${getRepositoryUrl()} in Netlify and create or confirm the production site.`,
    );
    console.log('2. Ensure the site is linked to this repo and uses netlify.toml.');
    console.log('3. Have the site name or site id available for the next step.');
    console.log('');
    console.log('Use these app values in Netlify if prompted:');
    console.log(
      `   BETTER_AUTH_SECRET = ${convexInfo?.betterAuthSecret ?? '[already set in Convex prod]'}`,
    );
    console.log(
      `   VITE_CONVEX_URL = ${convexInfo?.convexUrl ?? 'https://your-deployment.convex.cloud'}`,
    );
    console.log(
      `   VITE_CONVEX_SITE_URL = ${convexInfo?.convexSiteUrl ?? 'https://your-deployment.convex.site'}`,
    );
    console.log('');

    const readyForDeploySetup = await askYesNo(
      'Continue into GitHub deploy environment setup now?',
      true,
    );
    if (!readyForDeploySetup) {
      console.log('ℹ️  Skipping GitHub deploy environment setup for now.');
      console.log('   Later run: pnpm run setup:github-deploy');
      return;
    }

    const existingBetterAuthUrl = getExistingProdBetterAuthUrl();
    const rawNetlifySiteUrl = await askInput(
      '\nProduction Netlify URL for smoke checks/BETTER_AUTH_URL (press Enter to auto-detect later): ',
      existingBetterAuthUrl || undefined,
    );
    const normalizedNetlifySiteUrl = rawNetlifySiteUrl
      ? normalizeUrl(rawNetlifySiteUrl)
      : undefined;

    if (normalizedNetlifySiteUrl) {
      try {
        console.log(`\n🔐 Setting BETTER_AUTH_URL to ${normalizedNetlifySiteUrl}...`);
        execSync(`npx convex env set BETTER_AUTH_URL "${normalizedNetlifySiteUrl}" --prod`, {
          stdio: 'pipe',
          cwd: process.cwd(),
        });
        console.log('✅ BETTER_AUTH_URL configured in Convex production environment.');
      } catch {
        console.log(
          '⚠️ Failed to set BETTER_AUTH_URL. You may need additional permissions or can try again later with:',
        );
        console.log(`   npx convex env set BETTER_AUTH_URL "${normalizedNetlifySiteUrl}" --prod`);
      }
    }

    const { repo } = await configureGitHubDeployEnvironments({
      productionConvexDeployKey,
      productionDeploySmokeBaseUrl: normalizedNetlifySiteUrl,
    });

    console.log('\n🎊 Production setup complete!');
    console.log(`- GitHub repo: ${repo}`);
    console.log('- GitHub environments configured: staging, production');
    console.log('- GitHub repo secret configured: CONVEX_DEPLOY_KEY');
    console.log(
      '- GitHub environment secrets configured: CONVEX_DEPLOY_KEY, NETLIFY_BUILD_HOOK_URL, NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID',
    );
    console.log('- GitHub environment variable configured: DEPLOY_SMOKE_BASE_URL');
    console.log('- DR setup remains separate: pnpm run dr:setup');
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    console.log('\n💡 You can retry individual steps:');
    console.log('   • Convex: npx convex deploy');
    console.log('   • GitHub deploy envs: pnpm run setup:github-deploy');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
