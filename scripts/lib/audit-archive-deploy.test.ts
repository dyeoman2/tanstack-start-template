import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuditArchiveStackName, loadAuditArchiveDeployEnv } from './audit-archive-deploy';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const tsxLoaderPath = path.join(repoRoot, 'node_modules/tsx/dist/loader.mjs');

describe('audit archive deploy helper', () => {
  afterEach(() => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG;
    delete process.env.AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN;
    delete process.env.AWS_AUDIT_ARCHIVE_BUCKET_NAME;
    delete process.env.AWS_AUDIT_ARCHIVE_RETENTION_DAYS;
  });

  it('builds the expected stack name', () => {
    expect(buildAuditArchiveStackName('demo')).toBe('demo-audit-archive-stack');
  });

  it('loads .env.prod into a deterministic deploy config', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'audit-archive-deploy-'));
    writeFileSync(
      path.join(tempDir, '.env.prod'),
      [
        'AWS_REGION=us-west-1',
        'AWS_AUDIT_ARCHIVE_PROJECT_SLUG=demo',
        'AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN=arn:aws:iam::123:role/demo',
        'AWS_AUDIT_ARCHIVE_BUCKET_NAME=demo-audit',
        'AWS_AUDIT_ARCHIVE_RETENTION_DAYS=365',
      ].join('\n'),
      'utf8',
    );

    const config = loadAuditArchiveDeployEnv(tempDir);

    expect(config.stackName).toBe('demo-audit-archive-stack');
    expect(config.infraRoot).toBe(path.join(tempDir, 'infra', 'aws-cdk'));
    expect(config.env.AWS_REGION).toBe('us-west-1');
    expect(config.env.AWS_AUDIT_ARCHIVE_BUCKET_NAME).toBe('demo-audit');
    expect(config.env.AWS_AUDIT_ARCHIVE_RETENTION_DAYS).toBe('365');
  });

  it('runs the direct preview wrapper with the expected CDK arguments', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'audit-archive-wrapper-'));
    const binDir = path.join(tempDir, 'bin');
    const infraRoot = path.join(tempDir, 'infra', 'aws-cdk');
    const logPath = path.join(tempDir, 'pnpm-log.json');
    const wrapperPath = path.join(repoRoot, 'infra/audit-archive.ts');

    mkdirSync(binDir, { recursive: true });
    mkdirSync(infraRoot, { recursive: true });
    writeFileSync(
      path.join(tempDir, '.env.prod'),
      [
        'AWS_REGION=us-west-1',
        'AWS_AUDIT_ARCHIVE_PROJECT_SLUG=demo',
        'AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN=arn:aws:iam::123:role/demo',
      ].join('\n'),
      'utf8',
    );
    const pnpmStub = path.join(binDir, 'pnpm');
    writeFileSync(
      pnpmStub,
      `#!/usr/bin/env node
const fs = require('node:fs');
const payload = {
  args: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    AWS_REGION: process.env.AWS_REGION,
    AWS_AUDIT_ARCHIVE_PROJECT_SLUG: process.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG,
    AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN: process.env.AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN,
  },
};
fs.writeFileSync(process.env.TEST_PNPM_LOG_PATH, JSON.stringify(payload, null, 2));
process.exit(0);
`,
      'utf8',
    );
    chmodSync(pnpmStub, 0o755);

    const result = spawnSync(
      process.execPath,
      ['--import', tsxLoaderPath, wrapperPath, '--preview'],
      {
        cwd: tempDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          TEST_PNPM_LOG_PATH: logPath,
        },
      },
    );

    expect(result.status).toBe(0);
    const logged = JSON.parse(readFileSync(logPath, 'utf8')) as {
      args: string[];
      cwd: string;
      env: Record<string, string>;
    };
    expect(realpathSync(logged.cwd)).toBe(realpathSync(infraRoot));
    expect(logged.args).toEqual([
      'exec',
      'cdk',
      'synth',
      '--app',
      'node ./bin/app.mjs',
      'demo-audit-archive-stack',
    ]);
    expect(logged.env.AWS_REGION).toBe('us-west-1');
    expect(logged.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG).toBe('demo');
  });
});
