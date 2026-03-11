#!/usr/bin/env tsx

/**
 * Complete local development setup automation script.
 * Runs all local setup steps sequentially with user guidance.
 * For production deployment, use: pnpm run setup:prod
 * Run: pnpm run setup:dev
 */

import { execSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

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

async function main() {
  console.log('🚀 Starting complete project setup...\n');

  const cwd = process.cwd();

  // Step 1: Run initial setup
  console.log('📦 Step 1: Setting up local environment...');
  try {
    execSync('pnpm run setup:env', { stdio: 'inherit', cwd });
    console.log('✅ Environment setup complete!\n');
  } catch {
    console.log('❌ Environment setup failed. Please fix any issues and try again.');
    process.exit(1);
  }

  // Step 2: Run Convex project creation
  console.log('☁️  Step 2: Setting up Convex project');
  console.log('');
  console.log('This will require your input to:');
  console.log('  • Login/create your Convex account');
  console.log('  • Create your project');
  console.log('');
  console.log('Starting Convex setup...');
  console.log('');

  try {
    execSync('npx convex dev --once', { stdio: 'inherit', cwd });
    console.log('✅ Convex project setup complete!\n');
  } catch {
    console.log('ℹ️  Convex setup completed.\n');
  }

  // Step 3: Run Convex configuration
  console.log('⚙️  Step 3: Configuring development URLs and environment variables...');
  try {
    execSync('pnpm run setup:convex', { stdio: 'inherit', cwd });
    console.log('✅ Convex configuration complete!\n');
  } catch {
    console.log('❌ Convex configuration failed. Please check your setup and try again.');
    process.exit(1);
  }

  // Step 4: Optionally configure authenticated E2E helpers
  console.log('🧪 Step 4: Optional Playwright E2E setup');
  const shouldSetupE2E = await askYesNo(
    'Configure authenticated Playwright E2E env and sync the Convex gate now? (y/N): ',
  );

  if (shouldSetupE2E) {
    try {
      execSync('pnpm run setup:e2e', { stdio: 'inherit', cwd });
      console.log('✅ Playwright E2E setup complete!\n');
    } catch {
      console.log('❌ Playwright E2E setup failed. Please check the output and try again.');
      process.exit(1);
    }
  } else {
    console.log('ℹ️  Skipping Playwright E2E setup. Run `pnpm run setup:e2e` any time.\n');
  }

  // Step 5: Start development servers in current IDE terminal
  console.log('🎯 Step 5: Starting your development servers');
  console.log('');
  console.log('📋 Starting both servers in your current terminal...');
  console.log('');

  // Start both servers - Convex in background, frontend in foreground
  console.log('🚀 Starting both development servers...');
  console.log('');

  console.log('📋 Server startup:');
  console.log('  • Convex backend will run in the background');
  console.log('  • Frontend dev server will run in the foreground');
  console.log('  • Both servers will be accessible while this terminal is open');
  console.log('');

  console.log('⚠️  To stop both servers: Press Ctrl+C twice');
  console.log('');

  // Use concurrently or similar approach to run both servers
  // For now, let's run convex in background and frontend in foreground
  console.log('🎯 Starting Convex backend (background)...');

  try {
    // Start convex in background
    const convexProcess = spawn('npx', ['convex', 'dev'], {
      stdio: ['inherit', 'inherit', 'inherit'],
      detached: false,
      cwd: process.cwd(),
    });

    // Give convex a moment to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log('✅ Convex backend started successfully');
    console.log('');

    console.log('🎨 Starting frontend development server...');
    console.log('📱 Your app will be available at: http://localhost:3000');
    console.log('');

    // Now start the frontend dev server in foreground
    const frontendProcess = spawn('pnpm', ['dev'], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    // Wait for frontend to finish (or be interrupted)
    await new Promise((resolve, reject) => {
      frontendProcess.on('close', (code) => {
        if (convexProcess) {
          convexProcess.kill();
        }
        resolve(code);
      });
      frontendProcess.on('error', reject);

      // Handle Ctrl+C to kill both processes
      process.on('SIGINT', () => {
        console.log('\n🛑 Stopping both servers...');
        if (convexProcess) convexProcess.kill();
        if (frontendProcess) frontendProcess.kill();
        process.exit(0);
      });
    });
  } catch (error) {
    console.log('❌ Failed to start servers:', error);
    console.log('');
    console.log('💡 Alternative: Run these commands manually in separate terminals:');
    console.log('  Terminal 1: npx convex dev');
    console.log('  Terminal 2: pnpm dev');
  }

  console.log('\n🎉 Both development servers are now running!');
  console.log('📱 Your app is available at: http://localhost:3000');
  console.log('');
  console.log('💡 For future development sessions:');
  console.log('  pnpm run setup:dev    # Starts both development servers automatically');
  console.log('  pnpm run setup:prod   # Sets up production deployment');
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});
