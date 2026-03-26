import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tsxLoaderPath = path.join(repoRoot, 'node_modules/tsx/dist/loader.mjs');
const scriptPath = path.resolve(import.meta.dirname, 'purge-auth-sessions.ts');

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function createStubWorkspace() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'purge-auth-sessions-'));
  const binDir = path.join(tempDir, 'bin');
  mkdirSync(binDir, { recursive: true });

  writeExecutable(
    path.join(binDir, 'pnpm'),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'exec' && args[1] === 'convex' && args[2] === '--version') {
  process.stdout.write('convex-test-version\\n');
  process.exit(0);
}
if (args[0] === 'exec' && args[1] === 'convex' && args[2] === 'run' && args[3] === 'auth:purgeAllSessions') {
  process.stdout.write(JSON.stringify({ batchCount: 2, deletedCount: 5 }) + '\\n');
  process.exit(0);
}
process.stderr.write('unexpected pnpm args: ' + args.join(' '));
process.exit(1);
`,
  );

  return { binDir, tempDir };
}

describe('purge auth sessions script', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('rejects production purge without secret-tier acknowledgment', () => {
    const workspace = createStubWorkspace();
    tempDirs.push(workspace.tempDir);

    const result = spawnSync(
      process.execPath,
      ['--import', tsxLoaderPath, scriptPath, '--prod', '--json'],
      {
        cwd: workspace.tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${workspace.binDir}:${process.env.PATH ?? ''}`,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-tier production access');
  });

  it('purges production sessions when explicitly acknowledged', () => {
    const workspace = createStubWorkspace();
    tempDirs.push(workspace.tempDir);

    const result = spawnSync(
      process.execPath,
      ['--import', tsxLoaderPath, scriptPath, '--prod', '--json', '--ack-secret-tier'],
      {
        cwd: workspace.tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${workspace.binDir}:${process.env.PATH ?? ''}`,
        },
      },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      batchCount: number;
      deletedCount: number;
      target: string;
    };
    expect(parsed).toEqual({
      batchCount: 2,
      deletedCount: 5,
      target: 'prod',
      schemaVersion: 1,
    });
  });
});
