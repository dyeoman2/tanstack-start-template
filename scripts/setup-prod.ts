#!/usr/bin/env tsx

/**
 * Production deployment setup script.
 * Handles complete production setup including Convex and Netlify deployment.
 * Run: pnpm run setup:prod
 */

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// Helper functions for user input
async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

async function _askInput(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getGitRemote(): Promise<string | null> {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf8',
      cwd: process.cwd(),
    }).trim();
    return remoteUrl;
  } catch {
    return null;
  }
}

async function _checkNetlifyCLI(): Promise<boolean> {
  try {
    execSync('netlify --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
async function setupConvexProduction(): Promise<{
  convexUrl: string;
  deploymentName: string;
  deployOutput: string;
} | null> {
  console.log('\n🚀 Setting up Convex production...');

  // Generate secrets
  const betterAuthSecret = execSync('openssl rand -base64 32', { encoding: 'utf8' }).trim();

  console.log('\n⚙️  Setting production environment variables...');

  // Set production environment variables
  const prodEnvVars = [
    { name: 'BETTER_AUTH_SECRET', value: betterAuthSecret },
    { name: 'APP_NAME', value: 'TanStack Start Template' },
    { name: 'RESEND_EMAIL_SENDER', value: 'onboarding@resend.dev' },
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
    // Actually deploy to production and capture the deployment URL
    const deployOutput = execSync('npx convex deploy --yes 2>&1', {
      encoding: 'utf8',
      cwd: process.cwd(),
      stdio: ['inherit', 'pipe', 'inherit'], // Show progress, capture stdout, show stderr
    });

    console.log('✅ Convex production deployment complete!\n', deployOutput);

    // Extract production deployment info from the output
    // Look for the deployment URL in the success message
    const urlIndex = deployOutput.indexOf('https://');
    if (urlIndex !== -1) {
      const urlStart = deployOutput.substring(urlIndex);
      const urlEnd = urlStart.indexOf('\n') !== -1 ? urlStart.indexOf('\n') : urlStart.length;
      const url = urlStart.substring(0, urlEnd).trim();
      const deploymentMatch = url.match(/https:\/\/([a-z0-9-]+)\.convex\.cloud/);
      if (deploymentMatch) {
        const deploymentName = deploymentMatch[1];
        const convexUrl = `https://${deploymentName}.convex.cloud`;
        return { convexUrl, deploymentName, deployOutput };
      }
    }

    return null;
  } catch (_error) {
    console.log('❌ Convex deployment failed. You can try again later with: npx convex deploy');
    console.log('   Make sure you have the correct permissions and environment variables set.');
    throw new Error('Convex deployment failed');
  }
}

async function main() {
  try {
    // Check git remote
    console.log('📋 Checking git repository...');
    const remoteUrl = await getGitRemote();

    if (!remoteUrl) {
      console.log('❌ No git remote found. Please set up your git repository first:');
      console.log('   git remote add origin <your-repo-url>');
      console.log('   git push -u origin main');
      console.log('');
      console.log('Then run this script again.');
      process.exit(1);
    }

    console.log(`   ✅ Git remote found: ${remoteUrl}`);

    // Confirm they want to proceed
    const shouldContinue = await askYesNo('\nReady to set up production deployment? (y/N): ');
    if (!shouldContinue) {
      console.log('👋 Setup cancelled.');
      return;
    }

    // Step 1: Setup Convex production
    const convexInfo = await setupConvexProduction();
    if (!convexInfo) {
      console.log(
        '⚠️  Could not determine Convex deployment information. Continuing with manual setup...',
      );
    }

    // Step 2: Setup Netlify deployment
    console.log('\n🌐 Netlify Deployment Setup');
    console.log('────────────────────────────');

    console.log('📋 Complete these steps to deploy to Netlify:');
    console.log('');
    console.log('1. Go to: https://app.netlify.com/start');
    console.log('2. Click "Import an existing project"');
    console.log(`3. Connect your repository: ${remoteUrl}`);
    console.log('4. Netlify will automatically detect your build settings from netlify.toml');
    console.log("5. You'll be prompted to enter these environment variables during site creation:");
    console.log('');

    // Get the values for the environment variables
    let convexUrl = '';
    let convexSiteUrl = '';
    let betterAuthSecret = '';

    if (convexInfo?.convexUrl) {
      convexUrl = convexInfo.convexUrl;
      convexSiteUrl = convexInfo.convexUrl.replace('.convex.cloud', '.convex.site');
    } else {
      // Try to get production deployment name from convex deploy output
      try {
        const deployOutput = execSync('echo "n" | npx convex deploy', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
        });

        // Extract deployment name from output like "Your prod deployment accomplished-lyrebird-287 serves traffic at:"
        const deploymentMatch = deployOutput.match(
          /Your prod deployment ([a-z-]+-[0-9]+) serves traffic at:/,
        );
        if (deploymentMatch) {
          const deploymentName = deploymentMatch[1];
          convexUrl = `https://${deploymentName}.convex.cloud`;
          convexSiteUrl = `https://${deploymentName}.convex.site`;
        } else {
          throw new Error('Could not extract deployment name from convex deploy output');
        }
      } catch {
        // Final fallback
        convexUrl = 'https://your-deployment.convex.cloud';
        convexSiteUrl = 'https://your-deployment.convex.site';
      }
    }

    // Get BETTER_AUTH_SECRET
    try {
      betterAuthSecret = execSync('npx convex env get BETTER_AUTH_SECRET --prod', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'], // Suppress stderr
      }).trim();
    } catch {
      betterAuthSecret = '[not found - will be prompted]';
    }

    console.log(`   BETTER_AUTH_SECRET = ${betterAuthSecret}`);
    console.log(`   VITE_CONVEX_URL = ${convexUrl}`);
    console.log(`   VITE_CONVEX_SITE_URL = ${convexSiteUrl}`);
    console.log('');
    console.log('   For CONVEX_DEPLOY_KEY:');
    console.log('   1. Go to https://dashboard.convex.dev');
    console.log('   2. Select your project');
    console.log('   3. Go to Settings → Deploy Keys');
    console.log('   4. Click "Generate Production Deploy Key"');
    console.log('   5. Copy the key (starts with "prod:")');
    console.log('');
    console.log('6. Click "Deploy site"');
    console.log('');
    console.log('💡 Your site will be live at: https://your-site-name.netlify.app');

    console.log('\n🎊 All done! Your app is now live in production!');
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    console.log('\n💡 You can retry individual steps:');
    console.log('   • Convex: npx convex deploy');
    console.log('   • Netlify: netlify deploy --prod');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
