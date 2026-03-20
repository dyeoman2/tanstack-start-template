#!/usr/bin/env tsx

/**
 * Set up Convex URLs after Convex project initialization.
 * Syncs from `.env.local` into Convex (dev): BETTER_AUTH_SECRET, optional BETTER_AUTH_URL,
 * APP_NAME, optional Resend / OpenRouter / Google OAuth / RESEND_API_KEY.
 * Run: pnpm run setup:convex
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { deriveConvexSiteUrl } from '../src/lib/convex-url';
import { requirePnpmAndConvexCli } from './lib/cli-preflight';
import { convexEnvSet, convexRun } from './lib/convex-cli';
import { removeStructuredEnvValue, upsertStructuredEnvValue } from './lib/env-file';
import {
  printJwksRemediation,
  syncConvexJwksFromBetterAuth,
  verifyConvexJwksConfigured,
} from './lib/deploy-env-helpers';
import { DEFAULT_APP_NAME } from './lib/setup-defaults';
import { emitStructuredOutput, routeLogsToStderrWhenJson } from './lib/script-ux';

function printUsage() {
  console.log('Usage: pnpm run setup:convex [--json]');
  console.log('');
  console.log('What this does:');
  console.log('- Ensures local Convex URLs are present in .env.local');
  console.log('- Syncs app/auth/provider env vars from .env.local to Convex dev');
  console.log('- Seeds OpenRouter model catalogs when configured');
  console.log('- Verifies or refreshes JWKS in Convex dev');
  console.log('');
  console.log('Docs: docs/SCRIPT_AUTOMATION.md');
  console.log('Safe to rerun: yes; this refreshes Convex dev configuration.');
}

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
  convexEnvSet(name, value, false);
}

function runOpenRouterSeed(actionName: 'importTopFreeModels' | 'importTopPaidModels') {
  const setupActionName =
    actionName === 'importTopFreeModels'
      ? 'importTopFreeModelsForSetup'
      : 'importTopPaidModelsForSetup';
  convexRun(`adminModelImports:${setupActionName}`, '{}');
}

async function main() {
  const json = process.argv.includes('--json');
  routeLogsToStderrWhenJson(json);
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }
  const updatedConvexKeys: string[] = [];
  let updatedEnvFile = false;
  let seededOpenRouter = false;
  let jwksSynced = false;

  console.log('🔧 Setting up Convex URLs...\n');
  console.log(
    'What this does: update local Convex URLs if needed and sync dev env from .env.local into Convex.',
  );
  console.log('Prereqs: .env.local exists and the repo is linked to a Convex dev deployment.');
  console.log(
    'Modifies: .env.local when URL placeholders remain or obsolete Convex URL keys exist, plus Convex dev env vars and optional model seeds.',
  );
  console.log('Safe to rerun: yes.\n');
  requirePnpmAndConvexCli();

  const envPath = join(process.cwd(), '.env.local');

  // Check if .env.local exists
  if (!existsSync(envPath)) {
    console.log('❌ .env.local not found!');
    console.log('');
    console.log('📋 Setup Steps (run in order):');
    console.log('   1. pnpm run setup:env    # Create .env.local with secrets');
    console.log('   2. pnpm exec convex dev        # Initialize Convex project');
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
    console.log('   🔄 pnpm exec convex dev        # Do this next (interactively)');
    console.log("   ⏳ pnpm run setup:convex # You're here now");
    console.log('');
    console.log('🚀 Run: pnpm exec convex dev');
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
      console.log('👋 Exiting. Run "pnpm exec convex dev" first, then try again.');
      process.exit(0);
    }

    // Validate the URL
    if (!convexUrl.startsWith('https://') || !convexUrl.includes('.convex.cloud')) {
      console.log('❌ Invalid URL format!');
      console.log('   Expected: https://your-project.convex.cloud');
      console.log(`   Got: ${convexUrl}`);
      console.log('');
      console.log('💡 Make sure you copied the URL from "pnpm exec convex dev" output.');
      process.exit(1);
    }

    siteUrl = deriveConvexSiteUrl(convexUrl);

    let updatedEnvContent = upsertStructuredEnvValue(envContent, 'VITE_CONVEX_URL', convexUrl, {
      sectionMarker: '# CONVEX DATABASE',
    });
    updatedEnvContent = removeStructuredEnvValue(updatedEnvContent, 'VITE_CONVEX_SITE_URL');

    writeFileSync(envPath, updatedEnvContent, 'utf8');
    envContent = updatedEnvContent; // Update for later use
    updatedEnvFile = true;

    console.log('✅ Convex URLs configured!');
    console.log(`   📁 Updated: ${envPath}`);
    console.log('────────────────────────────────────────────────');
    console.log('🔗 Added URLs:');
    console.log(`   VITE_CONVEX_URL: ${convexUrl}`);
    console.log(`   Derived Convex site URL: ${siteUrl}`);
    console.log('────────────────────────────────────────────────');
  } else {
    const convexUrlMatch = envContent.match(/VITE_CONVEX_URL=(.*)/);
    const convexDeploymentMatch = envContent.match(/CONVEX_DEPLOYMENT=(.*)/);

    if (convexUrlMatch?.[1]?.trim()) {
      convexUrl = convexUrlMatch[1].trim();
    } else if (convexDeploymentMatch?.[1]?.trim()) {
      const deploymentName = convexDeploymentMatch[1].trim().replace('dev:', '');
      convexUrl = `https://${deploymentName}.convex.cloud`;
    }

    if (!convexUrl) {
      console.log('❌ Could not determine Convex URL from .env.local');
      console.log('');
      console.log('🔍 Expected to find: VITE_CONVEX_URL=https://your-project.convex.cloud');
      console.log('');
      console.log('💡 This usually means:');
      console.log('   • You haven\'t run "pnpm exec convex dev" yet, or');
      console.log("   • Convex setup didn't complete successfully");
      console.log('');
      console.log('🚀 Solution: Run "pnpm exec convex dev" and follow the prompts.');
      console.log('   Then run this command again.');
      process.exit(1);
    }

    siteUrl = deriveConvexSiteUrl(convexUrl);
    const cleanedEnvContent = removeStructuredEnvValue(envContent, 'VITE_CONVEX_SITE_URL');
    if (cleanedEnvContent !== envContent) {
      writeFileSync(envPath, cleanedEnvContent, 'utf8');
      envContent = cleanedEnvContent;
      updatedEnvFile = true;
      console.log('✅ Removed obsolete VITE_CONVEX_SITE_URL from .env.local.');
      console.log('────────────────────────────────────────────────');
      console.log('🔗 Derived Convex site URL:');
      console.log(`   ${siteUrl}`);
      console.log('────────────────────────────────────────────────');
    }
  }

  const betterAuthSecret = readOptionalEnvValue(envContent, 'BETTER_AUTH_SECRET');
  const betterAuthUrl = readOptionalEnvValue(envContent, 'BETTER_AUTH_URL');
  const appName = readOptionalEnvValue(envContent, 'APP_NAME') ?? DEFAULT_APP_NAME;
  const resendApiKey = readOptionalEnvValue(envContent, 'RESEND_API_KEY');
  const resendEmailSender = readOptionalEnvValue(envContent, 'RESEND_EMAIL_SENDER');
  const openRouterApiKey = readOptionalEnvValue(envContent, 'OPENROUTER_API_KEY');
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
    console.log(`   Derived Convex site URL: ${siteUrl}`);
    console.log('────────────────────────────────────────────────');
  }

  const envVars = [
    { name: 'BETTER_AUTH_SECRET', value: betterAuthSecret },
    ...(betterAuthUrl ? [{ name: 'BETTER_AUTH_URL', value: betterAuthUrl }] : []),
    { name: 'APP_NAME', value: appName },
    ...(resendApiKey ? [{ name: 'RESEND_API_KEY', value: resendApiKey }] : []),
    ...(resendEmailSender ? [{ name: 'RESEND_EMAIL_SENDER', value: resendEmailSender }] : []),
    ...(openRouterApiKey ? [{ name: 'OPENROUTER_API_KEY', value: openRouterApiKey }] : []),
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
      updatedConvexKeys.push(name);
    } catch {
      console.log(`   ⚠️  Failed to set ${name} (may already be set)`);
    }
  }

  console.log('✅ Convex environment variables configured!');
  console.log('────────────────────────────────────────────────');

  if (!resendApiKey) {
    console.log(
      'ℹ️  RESEND_API_KEY not in .env.local — add it there and rerun, or `pnpm exec convex env set RESEND_API_KEY ...`.',
    );
  }

  if ((googleClientId && !googleClientSecret) || (!googleClientId && googleClientSecret)) {
    console.log(
      '⚠️  Google OAuth: both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or BETTER_AUTH_GOOGLE_*) are required — Convex not updated for Google.',
    );
  }

  if (!openRouterApiKey) {
    console.log('ℹ️  OPENROUTER_API_KEY not found in .env.local. Skipping AI model seed.');
  } else {
    console.log('🌱 Seeding OpenRouter model catalogs...');

    for (const actionName of ['importTopFreeModels', 'importTopPaidModels'] as const) {
      try {
        console.log(`   Running ${actionName}...`);
        runOpenRouterSeed(actionName);
        seededOpenRouter = true;
      } catch {
        console.log(`   ⚠️  Failed to run ${actionName}. You can retry later from /app/admin.`);
      }
    }

    console.log('✅ OpenRouter model seeding complete!');
    console.log('────────────────────────────────────────────────');
  }

  if (!verifyConvexJwksConfigured('dev')) {
    console.log('🔑 JWKS missing — fetching from Better Auth and pushing to Convex...');
    try {
      syncConvexJwksFromBetterAuth('dev');
      jwksSynced = true;
    } catch {
      printJwksRemediation('dev');
    }
    if (!verifyConvexJwksConfigured('dev')) {
      printJwksRemediation('dev');
    }
  }
  if (json) {
    emitStructuredOutput({
      localEnvPath: envPath,
      updatedEnvFile,
      updatedConvexKeys,
      seededOpenRouter,
      jwksSynced,
    });
  }
}

main().catch((error) => {
  console.error('\n❌ Failed to set up Convex URLs');
  console.error(error);
  process.exit(1);
});
