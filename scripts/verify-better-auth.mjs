import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

function resolvePath(relativePath) {
  return new URL(relativePath, root);
}

async function readText(relativePath) {
  return await readFile(resolvePath(relativePath), 'utf8');
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootPath,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 1}`));
    });
  });
}

async function runOfficialBetterAuthCliCheck() {
  const outputFile = join(tmpdir(), 'better-auth-generated-schema.ts');

  console.log('[better-auth] Running official Better Auth CLI generate step');
  await run('pnpm', [
    'exec',
    'better-auth',
    'generate',
    '--config',
    'convex/betterAuth/options.ts',
    '--output',
    outputFile,
    '-y',
  ]);

  await rm(outputFile, { force: true });
}

function assertIncludes(source, pattern, description) {
  if (!source.includes(pattern)) {
    throw new Error(`Expected ${description} to include ${pattern}`);
  }
}

async function verifyPluginParity() {
  const [serverOptions, clientOptions, schema] = await Promise.all([
    readText('convex/betterAuth/sharedOptions.ts'),
    readText('src/features/auth/auth-client.ts'),
    readText('convex/betterAuth/schema.ts'),
  ]);

  assertIncludes(serverOptions, 'twoFactor(', 'server Better Auth plugin config');
  assertIncludes(serverOptions, 'passkey(', 'server Better Auth plugin config');
  assertIncludes(clientOptions, 'twoFactorClient()', 'client Better Auth plugin config');
  assertIncludes(clientOptions, 'passkeyClient()', 'client Better Auth plugin config');
  assertIncludes(schema, 'twoFactor:', 'Better Auth local schema');
  assertIncludes(schema, 'passkey:', 'Better Auth local schema');
}

async function verifyAuthOk() {
  const baseUrl = (process.env.BETTER_AUTH_VERIFY_URL || process.env.BETTER_AUTH_URL || '').trim();
  if (!baseUrl) {
    throw new Error(
      'BETTER_AUTH_VERIFY_URL or BETTER_AUTH_URL must be set to verify GET /api/auth/ok.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/ok`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GET /api/auth/ok returned ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || payload.status !== 'ok') {
      throw new Error('GET /api/auth/ok did not return { status: "ok" }');
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  await runOfficialBetterAuthCliCheck();

  console.log('[better-auth] Verifying plugin parity');
  await verifyPluginParity();

  console.log('[better-auth] Convex adapter detected; validating local Better Auth schema via codegen');
  await run('npx', ['convex', 'codegen']);

  console.log('[better-auth] Running TypeScript check');
  await run('pnpm', ['typecheck']);

  console.log('[better-auth] Verifying auth health endpoint');
  await verifyAuthOk();

  console.log('[better-auth] Verification complete');
}

await main();
