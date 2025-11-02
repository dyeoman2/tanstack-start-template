#!/usr/bin/env tsx

/**
 * Set up Convex URLs after Convex project initialization.
 * - VITE_CONVEX_URL: Convex deployment URL (from npx convex dev)
 * - VITE_CONVEX_SITE_URL: Site URL with .site instead of .cloud
 * Run: pnpm run setup:convex
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

async function main() {
  console.log('🔧 Setting up Convex URLs...\n');

  const envPath = join(process.cwd(), '.env.local');

  // Check if .env.local exists
  if (!existsSync(envPath)) {
    console.log('❌ .env.local not found!');
    console.log('');
    console.log('📋 Setup Steps (run in order):');
    console.log('   1. pnpm run setup        # Create .env.local with secrets');
    console.log('   2. npx convex dev        # Initialize Convex project');
    console.log('   3. pnpm run setup:convex # Configure URLs & environment variables');
    console.log('');
    console.log('💡 Start with: pnpm run setup');
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
    console.log("   ✅ pnpm run setup        # You've done this");
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
      console.log('   Got: ' + convexUrl);
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
    // Extract existing URLs for display
    console.log('🔍 Debug: Checking for Convex URLs in .env.local...');

    const convexUrlMatch = envContent.match(/VITE_CONVEX_URL=(.*)/);
    const siteUrlMatch = envContent.match(/VITE_CONVEX_SITE_URL=(.*)/);
    const convexDeploymentMatch = envContent.match(/CONVEX_DEPLOYMENT=(.*)/);

    console.log(
      `   CONVEX_DEPLOYMENT match: "${convexDeploymentMatch ? convexDeploymentMatch[1] : 'null'}"`,
    );
    console.log(`   VITE_CONVEX_URL match: "${convexUrlMatch ? convexUrlMatch[1] : 'null'}"`);
    console.log(`   VITE_CONVEX_SITE_URL match: "${siteUrlMatch ? siteUrlMatch[1] : 'null'}"`);

    if (convexUrlMatch && convexUrlMatch[1].trim()) {
      convexUrl = convexUrlMatch[1].trim();
      console.log(`   ✓ Using VITE_CONVEX_URL: ${convexUrl}`);
    } else if (convexDeploymentMatch && convexDeploymentMatch[1].trim()) {
      // Construct URL from deployment name (e.g., dev:quick-elk-245 -> https://quick-elk-245.convex.cloud)
      const deploymentName = convexDeploymentMatch[1].trim().replace('dev:', '');
      convexUrl = `https://${deploymentName}.convex.cloud`;
      console.log(`   ✓ Constructed URL from deployment: ${convexUrl}`);
    } else {
      console.log('   ❌ No valid Convex URL found');
    }

    if (siteUrlMatch) siteUrl = siteUrlMatch[1];

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

  // Read the BETTER_AUTH_SECRET from .env.local
  const betterAuthSecret = envContent.match(/BETTER_AUTH_SECRET=(.+)/)?.[1];

  if (!betterAuthSecret) {
    console.log('❌ Could not find BETTER_AUTH_SECRET in .env.local');
    console.log('   Please ensure pnpm run setup was run first.');
    process.exit(1);
  }

  console.log('🔧 Setting up Convex environment variables...');

  if (urlsConfigured) {
    console.log('ℹ️  Using existing Convex URLs:');
    console.log(`   VITE_CONVEX_URL: ${convexUrl}`);
    console.log(`   VITE_CONVEX_SITE_URL: ${siteUrl}`);
    console.log('────────────────────────────────────────────────');
  }

  // Set required environment variables in Convex
  const envVars = [
    { name: 'BETTER_AUTH_SECRET', value: betterAuthSecret },
    { name: 'RESEND_EMAIL_SENDER', value: 'onboarding@resend.dev' },
    { name: 'APP_NAME', value: 'Hackathon' },
    // Note: AUTUMN_SECRET_KEY is optional and should be set manually if needed
    // { name: 'AUTUMN_SECRET_KEY', value: '<your-autumn-secret-key>' },
  ];

  for (const { name, value } of envVars) {
    try {
      console.log(`   Setting ${name}...`);
      execSync(`npx convex env set ${name} "${value}"`, {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
    } catch (error) {
      console.log(`   ⚠️  Failed to set ${name} (may already be set)`);
    }
  }

  console.log('✅ Convex environment variables configured!');
  console.log('────────────────────────────────────────────────');
}

main().catch((error) => {
  console.error('\n❌ Failed to set up Convex URLs');
  console.error(error);
  process.exit(1);
});
