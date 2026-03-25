#!/usr/bin/env tsx

/**
 * Complete local development setup automation script.
 * Runs all local setup steps sequentially with user guidance.
 * For production deployment, use: pnpm run setup:prod
 * Run: pnpm run setup:dev
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  commandOnPath,
  pnpmExecConvexWorks,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { upsertStructuredEnvValue } from './lib/env-file';
import { printFinalChangeSummary } from './lib/script-ux';

function printUsage() {
  console.log('Usage: pnpm run setup:dev');
  console.log('');
  console.log('What this does:');
  console.log('- Runs setup:env');
  console.log('- Offers optional vendor setup');
  console.log('- Runs convex project bootstrap');
  console.log('- Runs setup:convex');
  console.log('- Runs guided storage:setup');
  console.log('- Optionally runs setup:e2e');
  console.log('- Finishes with convex:env:verify and deploy:doctor checks');
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run setup:dev');
  console.log('');
  console.log('Safe to rerun: mostly yes');
  console.log('- Setup steps are rerunnable and do not start long-running dev processes.');
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}

async function askInput(question: string, initialValue?: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return await new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    if (initialValue) {
      rl.write(initialValue);
    }
  });
}

function readEnvFile(envPath: string) {
  return existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
}

function readEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = envContent.match(new RegExp(`^${escapedName}=(.*)$`, 'm'));
  return match?.[1]?.trim()?.replace(/^"(.*)"$/, '$1') || null;
}

function maybeQuote(value: string) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

async function guideOptionalVendors(envPath: string) {
  let envContent = readEnvFile(envPath);
  let updated = false;

  console.log('🔌 Step 2: Optional vendor setup');
  console.log(
    'These providers are optional. The template works without them, but specific features depend on them.',
  );
  console.log('- Resend powers password reset and transactional email delivery.');
  console.log('- OpenRouter powers the chat/AI model features.');
  console.log('');

  const shouldConfigureResend =
    !readEnvValue(envContent, 'RESEND_API_KEY') &&
    (await askYesNo('Configure Resend email now? (y/N): '));
  if (shouldConfigureResend) {
    console.log('\nResend setup');
    console.log('- Needed if you want password reset and other email flows to work.');
    if (commandOnPath('resend')) {
      console.log(
        '- Resend CLI detected, but this template does not automate API key creation through it yet.',
      );
    } else {
      console.log('- No supported Resend CLI automation detected here.');
      console.log(
        '- Create an account at https://resend.com, create an API key, then paste it below.',
      );
    }

    const resendApiKey = await askInput('Resend API key (press Enter to skip): ');
    if (resendApiKey) {
      console.log(
        'Press Enter to use onboarding@resend.dev. That works for testing with the email address you signed up for Resend with.',
      );
      console.log(
        'To send from other email addresses, authenticate your domain in Resend first and then use a sender on that domain.',
      );
      const resendSender =
        (await askInput('Sender email [onboarding@resend.dev]: ')) || 'onboarding@resend.dev';
      envContent = upsertStructuredEnvValue(envContent, 'RESEND_API_KEY', resendApiKey, {
        sectionMarker: '# RESEND EMAIL SETUP',
      });
      envContent = upsertStructuredEnvValue(
        envContent,
        'RESEND_EMAIL_SENDER',
        maybeQuote(resendSender),
        {
          sectionMarker: '# RESEND EMAIL SETUP',
        },
      );
      updated = true;
      console.log('✅ Stored Resend settings in .env.local');
    } else {
      console.log('ℹ️  Skipping Resend for now. Email flows will remain unconfigured.');
    }
    console.log('');
  }

  const shouldConfigureOpenRouter =
    !readEnvValue(envContent, 'OPENROUTER_API_KEY') &&
    (await askYesNo('Configure OpenRouter for chat/AI now? (y/N): '));
  if (shouldConfigureOpenRouter) {
    console.log('\nOpenRouter setup');
    console.log('- Needed if you want chat and model-driven AI features to work.');
    if (commandOnPath('openrouter')) {
      console.log(
        '- OpenRouter CLI detected, but this template does not automate API key creation through it yet.',
      );
    } else {
      console.log('- No supported OpenRouter CLI automation detected here.');
      console.log('- Create an account/key at https://openrouter.ai/keys, then paste it below.');
    }

    const openRouterApiKey = await askInput('OpenRouter API key (press Enter to skip): ');
    if (openRouterApiKey) {
      envContent = upsertStructuredEnvValue(envContent, 'OPENROUTER_API_KEY', openRouterApiKey, {
        sectionMarker: '# OPENROUTER AI SETUP',
      });
      updated = true;
      console.log('✅ Stored OpenRouter settings in .env.local');
    } else {
      console.log('ℹ️  Skipping OpenRouter for now. Chat/AI features will stay unconfigured.');
    }
    console.log('');
  }

  if (updated) {
    writeFileSync(envPath, envContent, 'utf8');
    console.log(`📝 Updated ${envPath} with optional vendor settings.\n`);
  }
}

function run(command: string, cwd: string) {
  execSync(command, { stdio: 'inherit', cwd });
}

function runCheck(command: string, cwd: string) {
  const result = spawnSync('/bin/zsh', ['-lc', command], {
    cwd,
    stdio: 'inherit',
  });

  return result.status === 0;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  console.log('🚀 Starting complete project setup...\n');
  console.log('What this does: guided local bootstrap plus optional storage/E2E setup.');
  console.log('Prereqs: pnpm on PATH; Convex CLI available through pnpm after install.');
  console.log('Modifies: .env.local, Convex dev env, and optional storage/E2E settings.');
  console.log('Safe to rerun: yes; this script is now configuration-only.\n');

  const cwd = process.cwd();
  const changedLocally: string[] = [];
  const changedRemotely: string[] = [];
  const nextCommands: string[] = [];
  const warnings: string[] = [];
  requireCommands([{ cmd: 'pnpm' }]);

  if (!pnpmExecConvexWorks(cwd)) {
    console.log('📦 Project dependencies are not installed yet.');
    const shouldInstall = await askYesNo('Run `pnpm install` now? (Y/n): ');
    if (!shouldInstall) {
      console.log('❌ Dependencies are required before local setup can continue.');
      console.log('   Run `pnpm install`, then rerun `pnpm run setup:dev`.');
      process.exit(1);
    }

    try {
      run('pnpm install', cwd);
      changedLocally.push('Installed project dependencies with pnpm');
      console.log('✅ Dependencies installed.\n');
    } catch {
      console.log('❌ `pnpm install` failed. Please fix the install issue and rerun setup.');
      process.exit(1);
    }
  }

  const envPath = join(cwd, '.env.local');

  // Step 1: Run initial setup
  console.log('📦 Step 1: Setting up local environment...');
  try {
    run('pnpm run setup:env', cwd);
    changedLocally.push('Updated .env.local through setup:env');
    console.log('✅ Environment setup complete!\n');
  } catch {
    console.log('❌ Environment setup failed. Please fix any issues and try again.');
    process.exit(1);
  }

  await guideOptionalVendors(envPath);

  // Step 3: Run Convex project creation
  console.log('☁️  Step 3: Setting up Convex project');
  console.log('');
  console.log('This will require your input to:');
  console.log('  • Login/create your Convex account');
  console.log('  • Create your project');
  console.log('');
  console.log('Starting Convex setup...');
  console.log('');

  requirePnpmAndConvexCli(cwd);
  try {
    run('pnpm exec convex dev --once', cwd);
    changedRemotely.push('Bootstrapped or linked the Convex development project');
    console.log('✅ Convex project setup complete!\n');
  } catch {
    console.log('ℹ️  Convex setup completed.\n');
  }

  // Step 4: Run Convex configuration
  console.log('⚙️  Step 4: Configuring development URLs and environment variables...');
  try {
    run('pnpm run setup:convex', cwd);
    changedRemotely.push('Synced local app env into Convex development');
    console.log('✅ Convex configuration complete!\n');
  } catch {
    console.log('❌ Convex configuration failed. Please check your setup and try again.');
    process.exit(1);
  }

  console.log('');
  console.log('📌 After you change secrets or URLs in .env.local:');
  console.log('   pnpm run setup:convex      # push dev Convex env from .env.local');
  console.log('   pnpm run convex:env:verify # drift check (names + non-secret values)');
  console.log('   pnpm run convex:jwks:sync  # keep JWKS aligned with Better Auth');
  console.log('');

  // Step 5: Configure storage
  console.log('🗂️  Step 5: 🔧 Storage setup');
  try {
    run('pnpm run storage:setup', cwd);
    changedLocally.push('Ran guided local storage setup');
    console.log('✅ Storage setup complete!\n');
  } catch {
    console.log('❌ Storage setup failed. Please check the output and try again.');
    process.exit(1);
  }

  // Step 6: Optionally configure authenticated E2E helpers
  console.log('🧪 Step 6: Optional Playwright E2E setup');
  const shouldSetupE2E = await askYesNo(
    'Configure authenticated Playwright E2E env and sync the Convex gate now? (y/N): ',
  );

  if (shouldSetupE2E) {
    try {
      run('pnpm run setup:e2e', cwd);
      changedLocally.push('Configured authenticated Playwright E2E env');
      changedRemotely.push('Synced E2E gate env into Convex development');
      console.log('✅ Playwright E2E setup complete!\n');
    } catch {
      console.log('❌ Playwright E2E setup failed. Please check the output and try again.');
      process.exit(1);
    }
  } else {
    console.log('ℹ️  Skipping Playwright E2E setup. Run `pnpm run setup:e2e` any time.\n');
    nextCommands.push('pnpm run setup:e2e');
  }

  console.log('🩺 Step 7: Final readiness checks');
  const convexEnvReady = runCheck('pnpm run convex:env:verify', cwd);
  const deployDoctorReady = runCheck('pnpm run deploy:doctor', cwd);

  if (!convexEnvReady) {
    warnings.push(
      'Convex dev env drift check failed. Rerun `pnpm run setup:convex` after fixing the missing or drifted values.',
    );
    nextCommands.push('pnpm run setup:convex');
    nextCommands.push('pnpm run convex:env:verify');
  }
  if (!deployDoctorReady) {
    warnings.push(
      'Deploy doctor found local readiness issues. Review the failed checks and rerun it after addressing them.',
    );
    nextCommands.push('pnpm run deploy:doctor');
  }

  nextCommands.push('pnpm dev');
  nextCommands.push('pnpm run dev:docker');
  nextCommands.push('pnpm make-admin <email>');
  nextCommands.push(
    'pnpm run agent:auth -- --session-name local-app --principal user --redirect-to /app',
  );
  nextCommands.push('pnpm run setup:prod');

  const finalSummary = {
    changedLocally,
    changedRemotely,
    nextCommands: [...new Set(nextCommands)],
    readiness: {
      convexEnv: convexEnvReady ? 'ready' : 'needs attention',
      e2e: shouldSetupE2E ? 'configured' : 'skipped',
      localSetup: 'ready',
      localReadiness: deployDoctorReady ? 'ready' : 'needs attention',
    },
    warnings,
  };

  console.log('\n🎉 Local development setup is complete.\n');
  printFinalChangeSummary(finalSummary);
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});
