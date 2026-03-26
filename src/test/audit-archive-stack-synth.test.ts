import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function synthesizeAuditArchiveTemplate(input?: { alertEmail?: string }) {
  const projectSlug = 'tanstack-start-template';
  const stackName = `${projectSlug}-audit-archive-stack`;
  const outDir = mkdtempSync(path.join(tmpdir(), 'audit-archive-synth-'));
  const env = {
    ...process.env,
    AWS_REGION: 'us-west-1',
    AWS_AUDIT_ARCHIVE_BUCKET_NAME: 'tanstack-start-template-audit-archive',
    AWS_AUDIT_ARCHIVE_PROJECT_SLUG: projectSlug,
    AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN: 'arn:aws:iam::111111111111:role/convex-runtime',
    CDK_DEFAULT_ACCOUNT: '111111111111',
    CDK_DEFAULT_REGION: 'us-west-1',
    ...(input?.alertEmail ? { AWS_STORAGE_ALERT_EMAIL: input.alertEmail } : {}),
  };

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'cdk',
      'synth',
      '--app',
      'node ./infra/aws-cdk/bin/app.mjs',
      stackName,
      '--output',
      outDir,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to synthesize audit archive stack.');
  }

  try {
    return JSON.parse(readFileSync(path.join(outDir, `${stackName}.template.json`), 'utf8')) as {
      Resources?: Record<string, { Properties?: Record<string, unknown>; Type?: string }>;
    };
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
}

function getResourcesByType(
  template: {
    Resources?: Record<string, { Properties?: Record<string, unknown>; Type?: string }>;
  },
  type: string,
) {
  return Object.entries(template.Resources ?? {}).filter(([, resource]) => resource.Type === type);
}

describe('audit archive stack synth', () => {
  it('creates SNS-backed archive alarms when an alert email is configured', () => {
    const template = synthesizeAuditArchiveTemplate({
      alertEmail: 'alerts@example.com',
    });

    const topics = getResourcesByType(template, 'AWS::SNS::Topic');
    const subscriptions = getResourcesByType(template, 'AWS::SNS::Subscription');
    const alarms = getResourcesByType(template, 'AWS::CloudWatch::Alarm');

    expect(topics).toHaveLength(1);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.[1].Properties).toMatchObject({
      Endpoint: 'alerts@example.com',
      Protocol: 'email',
    });
    expect(
      alarms.map(([, resource]) => String(resource.Properties?.AlarmDescription ?? '')).sort(),
    ).toEqual([
      'Immutable audit archive exporter is disabled.',
      'Immutable audit archive lag is greater than zero.',
      'Immutable audit archive seal/export drift detected.',
      'Latest immutable audit archive seal is not verified in object lock storage.',
    ]);
    expect(alarms.every(([, resource]) => Array.isArray(resource.Properties?.AlarmActions))).toBe(
      true,
    );
  });

  it('does not create archive alarms without an alert email', () => {
    const template = synthesizeAuditArchiveTemplate();
    const alarms = getResourcesByType(template, 'AWS::CloudWatch::Alarm');
    const subscriptions = getResourcesByType(template, 'AWS::SNS::Subscription');

    expect(alarms).toHaveLength(0);
    expect(subscriptions).toHaveLength(0);
  });
});
