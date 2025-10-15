#!/usr/bin/env tsx

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

function log(message: string) {
  console.log(`⚙️  ${message}`);
}

async function ensureDockerIsRunning() {
  log('Launching Docker Desktop (if not already running)...');
  const openResult = spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' });

  if (openResult.status !== 0) {
    console.warn('⚠️  Unable to launch Docker Desktop automatically. Continuing...');
  }

  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const check = spawnSync('docker', ['info'], { stdio: 'ignore' });
    if (check.status === 0) {
      log('Docker daemon is available.');
      return;
    }

    if (attempt === 1) {
      console.log('⏳ Waiting for Docker daemon to become ready...');
    }

    await sleep(2000);
  }

  throw new Error('Docker daemon did not become ready within the expected time.');
}

async function startMinio() {
  log('Starting MinIO container (docker-compose up -d)...');
  let up = spawnSync('docker-compose', ['up', '-d'], { stdio: 'inherit' });

  const upError = up.error as NodeJS.ErrnoException | undefined;

  if (upError && upError.code === 'ENOENT') {
    log('docker-compose not found, trying "docker compose"...');
    up = spawnSync('docker', ['compose', 'up', '-d'], { stdio: 'inherit' });
  }

  if (up.status !== 0) {
    throw new Error('Failed to start containers using docker-compose.');
  }
}

async function startViteDevServer() {
  log('Starting Vite development server...');
  const vite = spawn('vite', ['dev'], { stdio: 'inherit' });

  vite.on('close', (code) => {
    if (code !== null && code !== 0) {
      console.error(`❌ Vite exited with code ${code}`);
      process.exit(code);
    }
    process.exit(0);
  });

  const handleSignal = (signal: NodeJS.Signals) => {
    vite.kill(signal);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

async function main() {
  await ensureDockerIsRunning();
  await startMinio();
  await startViteDevServer();
}

main().catch((error) => {
  console.error('❌ Failed to start full development environment:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
