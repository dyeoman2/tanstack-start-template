import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tsxLoaderPath = path.join(repoRoot, 'node_modules/tsx/dist/loader.mjs');
const scriptPath = path.resolve(import.meta.dirname, 'setup-audit-archive.ts');

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function createStubWorkspace() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'audit-archive-setup-'));
  const binDir = path.join(tempDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(path.join(tempDir, 'infra', 'aws-cdk'), { recursive: true });

  writeExecutable(
    path.join(binDir, 'aws'),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'sts' && args[1] === 'get-caller-identity') {
  process.stdout.write(JSON.stringify({
    Account: '123456789012',
    Arn: 'arn:aws:iam::123456789012:role/test-principal',
  }));
  process.exit(0);
}
if (args[0] === 'cloudformation' && args[1] === 'describe-stacks') {
  const stackNameIndex = args.indexOf('--stack-name');
  const stackName = stackNameIndex >= 0 ? args[stackNameIndex + 1] : '';
  if (stackName === 'CDKToolkit') {
    process.stdout.write(JSON.stringify([]));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify([
    { OutputKey: 'AuditArchiveBucketName', OutputValue: 'demo-audit-bucket' },
    {
      OutputKey: 'AuditArchiveBucketKeyArn',
      OutputValue: 'arn:aws:kms:us-west-1:123456789012:key/demo',
    },
    {
      OutputKey: 'AuditArchiveRoleArn',
      OutputValue: 'arn:aws:iam::123456789012:role/demo-audit',
    },
  ]));
  process.exit(0);
}
if (args[0] === 'configure' && args[1] === 'list-profiles') {
  process.exit(0);
}
process.stderr.write('unexpected aws args: ' + args.join(' '));
process.exit(1);
`,
  );

  writeExecutable(
    path.join(binDir, 'pnpm'),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'exec' && args[1] === 'convex' && args[2] === '--version') {
  process.stdout.write('convex-test-version\\n');
  process.exit(0);
}
if (args[0] === 'exec' && args[1] === 'cdk' && args[2] === 'deploy') {
  process.exit(0);
}
if (args[0] === 'exec' && args[1] === 'convex' && args[2] === 'env' && args[3] === 'set') {
  process.exit(0);
}
if (args[0] === 'exec' && args[1] === 'convex' && args[2] === 'env' && args[3] === 'list') {
  process.exit(0);
}
process.stderr.write('unexpected pnpm args: ' + args.join(' '));
process.exit(1);
`,
  );

  return { binDir, tempDir };
}

describe('audit archive setup non-interactive', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('succeeds non-interactively with complete env and emits strict readiness json', () => {
    const workspace = createStubWorkspace();
    tempDirs.push(workspace.tempDir);

    const result = spawnSync(
      process.execPath,
      ['--import', tsxLoaderPath, scriptPath, '--prod', '--yes', '--json'],
      {
        cwd: workspace.tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${workspace.binDir}:${process.env.PATH ?? ''}`,
          AWS_REGION: 'us-west-1',
          AWS_AUDIT_ARCHIVE_PROJECT_SLUG: 'demo',
          AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN: 'arn:aws:iam::123456789012:role/test-principal',
          CONVEX_SECRET_TIER_ACK: '1',
        },
      },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readiness: Record<string, string>;
      changedLocally: string[];
      changedRemotely: string[];
    };
    expect(parsed.readiness).toEqual({
      auditArchive: 'ready',
      convexEnv: 'ready',
      operatorEnv: 'ready',
    });
    expect(parsed.changedRemotely).toContain('Deployed AWS audit archive infrastructure');
    expect(parsed.changedRemotely).toContain('Updated Convex production audit archive env vars');

    const envFile = readFileSync(path.join(workspace.tempDir, '.env.prod'), 'utf8');
    expect(envFile).toContain('AWS_AUDIT_ARCHIVE_BUCKET=demo-audit-bucket');
    expect(envFile).toContain(
      'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN=arn:aws:kms:us-west-1:123456789012:key/demo',
    );
    expect(envFile).toContain(
      'AWS_AUDIT_ARCHIVE_ROLE_ARN=arn:aws:iam::123456789012:role/demo-audit',
    );
  });

  it('fails non-interactively when the trusted principal ARN is missing', () => {
    const workspace = createStubWorkspace();
    tempDirs.push(workspace.tempDir);

    const result = spawnSync(
      process.execPath,
      ['--import', tsxLoaderPath, scriptPath, '--prod', '--yes', '--json'],
      {
        cwd: workspace.tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${workspace.binDir}:${process.env.PATH ?? ''}`,
          AWS_REGION: 'us-west-1',
          AWS_AUDIT_ARCHIVE_PROJECT_SLUG: 'demo',
          CONVEX_SECRET_TIER_ACK: '1',
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Trusted principal ARN for the audit archive role is required in non-interactive mode.',
    );
  });
});
