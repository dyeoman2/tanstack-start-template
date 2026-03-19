#!/usr/bin/env tsx

/**
 * Set up Convex URLs after Convex project initialization.
 * Syncs from `.env.local` into Convex (dev): BETTER_AUTH_SECRET, optional BETTER_AUTH_URL,
 * APP_NAME, optional Resend / OpenRouter / Google OAuth / RESEND_API_KEY.
 * Run: pnpm run setup:convex
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DEFAULT_APP_NAME } from './lib/setup-defaults';

function readOptionalEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = envContent.match(new RegExp(`^${escapedName}=(.*)$`, 'm'));
  if (!match) {
    return null;
  }

  const rawValue = match[1]?.trim();
  if (!rawValue) {
    return null;
  }

  if (
    rawValue.startsWith('<') ||
    rawValue.includes('your-openrouter-api-key') ||
    rawValue.includes('your-')
  ) {
    return null;
  }

  return rawValue.replace(/^"(.*)"$/, '$1');
}

function runConvexEnvSet(name: string, value: string) {
  execSync(`npx convex env set ${name} ${JSON.stringify(value)}`, {
    stdio: 'pipe',
    cwd: process.cwd(),
  });
}

function runOpenRouterSeed(actionName: 'importTopFreeModels' | 'importTopPaidModels') {
  execSync(`npx convex run adminModelImports:${actionName} '{}'`, {
    stdio: 'pipe',
    cwd: process.cwd(),
  });
}

async function main() {
  console.log('🔧 Setting up Convex URLs...\n');

  const envPath = join(process.cwd(), '.env.local');

  // Check if .env.local exists
  if (!existsSync(envPath)) {
    console.log('❌ .env.local not found!');
    console.log('');
    console.log('📋 Setup Steps (run in order):');
    console.log('   1. pnpm run setup:env    # Create .env.local with secrets');
    console.log('   2. npx convex dev        # Initialize Convex project');
    console.log('   3. pnpm run setup:convex # Configure URLs & environment variables');
    console.log('');
    console.log('💡 Start with: pnpm run setup:env');
    process.exit(1);
  }

  // Read existing .env.local
  let envContent = readFileSync(envPath, 'utf8');
  // Check if URLs are configured (exist and have non-empty values)
  const convexUrlMatch = envContent.match(/VITE_CONVEX_URL=(.*)/);
  const urlsConfigured = convexUrlMatch && convexUrlMatch[1].trim() !== '';

  let convexUrl = '';
  let siteUrl = '';

  if (!urlsConfigured) {
    console.log('ℹ️  Convex deployment URLs not found in .env.local');
    console.log('');
    console.log('🔍 Looking for: VITE_CONVEX_URL=https://your-project.convex.cloud');
    console.log('');
    console.log("💡 This usually means you haven't run Convex setup yet.");
    console.log('');
    console.log('📋 Complete setup steps:');
    console.log("   ✅ pnpm run setup:env    # You've done this");
    console.log('   🔄 npx convex dev        # Do this next (interactively)');
    console.log("   ⏳ pnpm run setup:convex # You're here now");
    console.log('');
    console.log('🚀 Run: npx convex dev');
    console.log('   Then come back and run this command again.');
    console.log('');

    // Still allow manual entry for advanced users
    console.log('💪 Advanced: Enter your Convex deployment URL manually');
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    convexUrl = await new Promise<string>((resolve) => {
      rl.question('Convex deployment URL (or press Enter to exit): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (!convexUrl) {
      console.log('👋 Exiting. Run "npx convex dev" first, then try again.');
      process.exit(0);
    }

    // Validate the URL
    if (!convexUrl.startsWith('https://') || !convexUrl.includes('.convex.cloud')) {
      console.log('❌ Invalid URL format!');
      console.log('   Expected: https://your-project.convex.cloud');
      console.log(`   Got: ${convexUrl}`);
      console.log('');
      console.log('💡 Make sure you copied the URL from "npx convex dev" output.');
      process.exit(1);
    }

    // Generate site URL by replacing .cloud with .site
    siteUrl = convexUrl.replace('.convex.cloud', '.convex.site');

    // Add Convex URLs to .env.local - replace just the site URL placeholder
    const updatedEnvContent = envContent.replace(
      '# VITE_CONVEX_SITE_URL=Derived from VITE_CONVEX_URL (replace .cloud with .site)',
      `VITE_CONVEX_SITE_URL=${siteUrl}`,
    );

    writeFileSync(envPath, updatedEnvContent, 'utf8');
    envContent = updatedEnvContent; // Update for later use

    console.log('✅ Convex URLs configured!');
    console.log(`   📁 Updated: ${envPath}`);
    console.log('────────────────────────────────────────────────');
    console.log('🔗 Added URLs:');
    console.log(`   VITE_CONVEX_URL: ${convexUrl}`);
    console.log(`   VITE_CONVEX_SITE_URL: ${siteUrl}`);
    console.log('────────────────────────────────────────────────');
  } else {
    const convexUrlMatch = envContent.match(/VITE_CONVEX_URL=(.*)/);
    const siteUrlMatch = envContent.match(/VITE_CONVEX_SITE_URL=(.*)/);
    const convexDeploymentMatch = envContent.match(/CONVEX_DEPLOYMENT=(.*)/);

    if (convexUrlMatch?.[1]?.trim()) {
      convexUrl = convexUrlMatch[1].trim();
    } else if (convexDeploymentMatch?.[1]?.trim()) {
      const deploymentName = convexDeploymentMatch[1].trim().replace('dev:', '');
      convexUrl = `https://${deploymentName}.convex.cloud`;
    }

    if (siteUrlMatch?.[1]) {
      siteUrl = siteUrlMatch[1].trim();
    }

    // Check if VITE_CONVEX_SITE_URL needs to be set (empty or placeholder)
    if (
      !siteUrl ||
      siteUrl.trim() === '' ||
      siteUrl.includes('Derived from VITE_CONVEX_URL') ||
      siteUrl.includes('set after running')
    ) {
      if (!convexUrl) {
        console.log('❌ Could not determine Convex URL from .env.local');
        console.log('');
        console.log('🔍 Expected to find: VITE_CONVEX_URL=https://your-project.convex.cloud');
        console.log('');
        console.log('💡 This usually means:');
        console.log('   • You haven\'t run "npx convex dev" yet, or');
        console.log("   • Convex setup didn't complete successfully");
        console.log('');
        console.log('🚀 Solution: Run "npx convex dev" and follow the prompts.');
        console.log('   Then run this command again.');
        process.exit(1);
      }

      console.log('ℹ️  VITE_CONVEX_SITE_URL needs to be set, updating...');
      const actualSiteUrl = convexUrl.replace('.convex.cloud', '.convex.site');

      // Replace any VITE_CONVEX_SITE_URL line that contains placeholder text
      const updatedEnvContent = envContent.replace(
        /^.*VITE_CONVEX_SITE_URL=.*(?:Derived from|set after running|replace \.cloud).*$/gm,
        `VITE_CONVEX_SITE_URL=${actualSiteUrl}`,
      );
      writeFileSync(envPath, updatedEnvContent, 'utf8');
      envContent = updatedEnvContent;
      siteUrl = actualSiteUrl;

      console.log('✅ VITE_CONVEX_SITE_URL updated!');
      console.log('────────────────────────────────────────────────');
      console.log('🔗 Updated URL:');
      console.log(`   VITE_CONVEX_SITE_URL: ${siteUrl}`);
      console.log('────────────────────────────────────────────────');
    }
  }

  const betterAuthSecret = readOptionalEnvValue(envContent, 'BETTER_AUTH_SECRET');
  const betterAuthUrl = readOptionalEnvValue(envContent, 'BETTER_AUTH_URL');
  const appName = readOptionalEnvValue(envContent, 'APP_NAME') ?? DEFAULT_APP_NAME;
  const resendApiKey = readOptionalEnvValue(envContent, 'RESEND_API_KEY');
  const resendEmailSender = readOptionalEnvValue(envContent, 'RESEND_EMAIL_SENDER');
  const openRouterApiKey = readOptionalEnvValue(envContent, 'OPENROUTER_API_KEY');
  const openRouterSiteUrl = readOptionalEnvValue(envContent, 'OPENROUTER_SITE_URL');
  const openRouterSiteName = readOptionalEnvValue(envContent, 'OPENROUTER_SITE_NAME');
  const googleClientId =
    readOptionalEnvValue(envContent, 'GOOGLE_CLIENT_ID') ??
    readOptionalEnvValue(envContent, 'BETTER_AUTH_GOOGLE_CLIENT_ID');
  const googleClientSecret =
    readOptionalEnvValue(envContent, 'GOOGLE_CLIENT_SECRET') ??
    readOptionalEnvValue(envContent, 'BETTER_AUTH_GOOGLE_CLIENT_SECRET');

  if (!betterAuthSecret) {
    console.log('❌ Could not find BETTER_AUTH_SECRET in .env.local');
    console.log('   Please ensure pnpm run setup:env was run first.');
    process.exit(1);
  }

  console.log('🔧 Setting up Convex environment variables...');

  if (urlsConfigured) {
    console.log('ℹ️  Using existing Convex URLs:');
    console.log(`   VITE_CONVEX_URL: ${convexUrl}`);
    console.log(`   VITE_CONVEX_SITE_URL: ${siteUrl}`);
    console.log('────────────────────────────────────────────────');
  }

  const envVars = [
    { name: 'BETTER_AUTH_SECRET', value: betterAuthSecret },
    ...(betterAuthUrl ? [{ name: 'BETTER_AUTH_URL', value: betterAuthUrl }] : []),
    { name: 'APP_NAME', value: appName },
    ...(resendApiKey ? [{ name: 'RESEND_API_KEY', value: resendApiKey }] : []),
    ...(resendEmailSender ? [{ name: 'RESEND_EMAIL_SENDER', value: resendEmailSender }] : []),
    ...(openRouterApiKey ? [{ name: 'OPENROUTER_API_KEY', value: openRouterApiKey }] : []),
    ...(openRouterSiteUrl ? [{ name: 'OPENROUTER_SITE_URL', value: openRouterSiteUrl }] : []),
    ...(openRouterSiteName ? [{ name: 'OPENROUTER_SITE_NAME', value: openRouterSiteName }] : []),
    ...(googleClientId && googleClientSecret
      ? [
          { name: 'GOOGLE_CLIENT_ID', value: googleClientId },
          { name: 'GOOGLE_CLIENT_SECRET', value: googleClientSecret },
        ]
      : []),
  ];

  for (const { name, value } of envVars) {
    try {
      console.log(`   Setting ${name}...`);
      runConvexEnvSet(name, value);
    } catch {
      console.log(`   ⚠️  Failed to set ${name} (may already be set)`);
    }
  }

  console.log('✅ Convex environment variables configured!');
  console.log('────────────────────────────────────────────────');

  if (!resendApiKey) {
    console.log(
      'ℹ️  RESEND_API_KEY not in .env.local — add it there and rerun, or `npx convex env set RESEND_API_KEY ...`.',
    );
  }

  if ((googleClientId && !googleClientSecret) || (!googleClientId && googleClientSecret)) {
    console.log(
      '⚠️  Google OAuth: both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or BETTER_AUTH_GOOGLE_*) are required — Convex not updated for Google.',
    );
  }

  if (!openRouterApiKey) {
    console.log('ℹ️  OPENROUTER_API_KEY not found in .env.local. Skipping AI model seed.');
    return;
  }

  console.log('🌱 Seeding OpenRouter model catalogs...');

  for (const actionName of ['importTopFreeModels', 'importTopPaidModels'] as const) {
    try {
      console.log(`   Running ${actionName}...`);
      runOpenRouterSeed(actionName);
    } catch {
      console.log(`   ⚠️  Failed to run ${actionName}. You can retry later from /app/admin.`);
    }
  }

  console.log('✅ OpenRouter model seeding complete!');
  console.log('────────────────────────────────────────────────');
}

main().catch((error) => {
  console.error('\n❌ Failed to set up Convex URLs');
  console.error(error);
  process.exit(1);
});
