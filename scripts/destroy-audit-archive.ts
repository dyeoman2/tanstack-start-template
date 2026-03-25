#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

type CommandResult = {
  ok: boolean;
  stderr: string;
  stdout: string;
};

type StackOutputs = Record<string, string>;

const DEFAULT_PROJECT_SLUG = 'tanstack-start-template';
const DEFAULT_REGION = 'us-west-1';
const MIN_KMS_PENDING_WINDOW_DAYS = 7;

function runCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });

  return {
    ok: result.status === 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function readEnvFile(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function readEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = Array.from(envContent.matchAll(new RegExp(`^${escapedName}=(.*)$`, 'gm')));
  const match = matches.at(-1);
  return match?.[1]?.trim()?.replace(/^"(.*)"$/, '$1') || null;
}

async function askYesNo(question: string, fallback = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = fallback ? 'Y/n' : 'y/N';
  return await new Promise<boolean>((resolve) => {
    rl.question(`${question} (${suffix}): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (!normalized) {
        resolve(fallback);
        return;
      }
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

function parseJson<T>(result: CommandResult): T | null {
  const raw = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (!raw) {
    return null;
  }

  const start = raw.indexOf('{') >= 0 ? raw.indexOf('{') : raw.indexOf('[');
  if (start < 0) {
    return null;
  }

  try {
    return JSON.parse(raw.slice(start)) as T;
  } catch {
    return null;
  }
}

function ensureOk(result: CommandResult, message: string) {
  if (!result.ok) {
    const details = [result.stdout, result.stderr].join('\n').trim();
    throw new Error(details ? `${message}\n${details}` : message);
  }
}

function buildAuditArchiveStackName(projectSlug: string) {
  return `${projectSlug}-audit-archive-stack`;
}

function getStackOutputs(stackName: string, region: string) {
  const result = runCommand(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      '--query',
      'Stacks[0].Outputs',
      '--output',
      'json',
    ],
    { AWS_REGION: region },
  );

  if (!result.ok) {
    return null;
  }

  const parsed = parseJson<Array<{ OutputKey?: string; OutputValue?: string }>>(result);
  if (!parsed) {
    return null;
  }

  const outputs: StackOutputs = {};
  for (const item of parsed) {
    if (item.OutputKey && item.OutputValue) {
      outputs[item.OutputKey] = item.OutputValue;
    }
  }
  return outputs;
}

function stackExists(stackName: string, region: string) {
  return runCommand(
    'aws',
    ['cloudformation', 'describe-stacks', '--stack-name', stackName, '--output', 'json'],
    { AWS_REGION: region },
  ).ok;
}

function deleteStack(stackName: string, region: string) {
  if (!stackExists(stackName, region)) {
    return false;
  }

  ensureOk(
    runCommand('aws', ['cloudformation', 'delete-stack', '--stack-name', stackName], {
      AWS_REGION: region,
    }),
    `Failed to delete stack ${stackName}`,
  );

  ensureOk(
    runCommand(
      'aws',
      ['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', stackName],
      { AWS_REGION: region },
    ),
    `Failed while waiting for stack ${stackName} deletion`,
  );

  return true;
}

function bucketExists(bucketName: string, region: string) {
  return runCommand('aws', ['s3api', 'head-bucket', '--bucket', bucketName], {
    AWS_REGION: region,
  }).ok;
}

function emptyBucket(bucketName: string, region: string) {
  while (true) {
    const listed = runCommand(
      'aws',
      ['s3api', 'list-object-versions', '--bucket', bucketName, '--output', 'json'],
      { AWS_REGION: region },
    );
    if (!listed.ok) {
      return;
    }

    const parsed = parseJson<{
      DeleteMarkers?: Array<{ Key?: string; VersionId?: string }>;
      Versions?: Array<{ Key?: string; VersionId?: string }>;
    }>(listed);

    const objects = [...(parsed?.Versions ?? []), ...(parsed?.DeleteMarkers ?? [])]
      .filter((item): item is { Key: string; VersionId: string } =>
        Boolean(item.Key && item.VersionId),
      )
      .map((item) => ({ Key: item.Key, VersionId: item.VersionId }));

    if (objects.length === 0) {
      break;
    }

    const chunks = Array.from({ length: Math.ceil(objects.length / 1000) }, (_, index) =>
      objects.slice(index * 1000, (index + 1) * 1000),
    );
    for (const chunk of chunks) {
      ensureOk(
        runCommand(
          'aws',
          [
            's3api',
            'delete-objects',
            '--bucket',
            bucketName,
            '--delete',
            JSON.stringify({ Objects: chunk }),
          ],
          { AWS_REGION: region },
        ),
        `Failed to delete objects from bucket ${bucketName}`,
      );
    }
  }
}

function deleteBucket(bucketName: string, region: string) {
  if (!bucketExists(bucketName, region)) {
    return false;
  }

  emptyBucket(bucketName, region);
  const deleted = runCommand('aws', ['s3api', 'delete-bucket', '--bucket', bucketName], {
    AWS_REGION: region,
  });
  ensureOk(deleted, `Failed to delete bucket ${bucketName}`);
  return true;
}

function describeKmsKey(keyId: string, region: string) {
  const result = runCommand('aws', ['kms', 'describe-key', '--key-id', keyId, '--output', 'json'], {
    AWS_REGION: region,
  });
  return parseJson<{
    KeyMetadata?: {
      DeletionDate?: string;
      KeyState?: string;
      KeyId?: string;
    };
  }>(result);
}

function scheduleKmsKeyDeletion(keyId: string, region: string) {
  const described = describeKmsKey(keyId, region);
  const keyState = described?.KeyMetadata?.KeyState?.trim();
  if (!keyState) {
    return 'missing';
  }
  if (keyState === 'PendingDeletion') {
    return 'already scheduled';
  }

  ensureOk(
    runCommand(
      'aws',
      [
        'kms',
        'schedule-key-deletion',
        '--key-id',
        keyId,
        '--pending-window-in-days',
        String(MIN_KMS_PENDING_WINDOW_DAYS),
      ],
      { AWS_REGION: region },
    ),
    `Failed to schedule KMS key deletion for ${keyId}`,
  );
  return 'scheduled';
}

function printUsage() {
  console.log('Usage: pnpm run audit-archive:destroy [-- --yes]');
  console.log('');
  console.log(
    'What this does: destroy the immutable audit archive stack, remove the retained S3 bucket, and schedule deletion for the retained KMS key.',
  );
  console.log('Safe to rerun: no; this is destructive.');
}

async function main() {
  const yes = process.argv.includes('--yes');
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const prodEnvContent = readEnvFile(path.join(process.cwd(), '.env.prod'));
  const region =
    process.env.AWS_REGION?.trim() ?? readEnvValue(prodEnvContent, 'AWS_REGION') ?? DEFAULT_REGION;
  const profile =
    process.env.AWS_PROFILE?.trim() ?? readEnvValue(prodEnvContent, 'AWS_PROFILE') ?? undefined;
  if (profile) {
    process.env.AWS_PROFILE = profile;
  }
  process.env.AWS_REGION = region;

  const projectSlug =
    process.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG?.trim() ??
    readEnvValue(prodEnvContent, 'AWS_AUDIT_ARCHIVE_PROJECT_SLUG') ??
    DEFAULT_PROJECT_SLUG;
  const stackName = buildAuditArchiveStackName(projectSlug);
  const outputs = getStackOutputs(stackName, region);
  const bucketName =
    outputs?.AuditArchiveBucketName?.trim() ??
    readEnvValue(prodEnvContent, 'AWS_AUDIT_ARCHIVE_BUCKET') ??
    readEnvValue(prodEnvContent, 'AWS_AUDIT_ARCHIVE_BUCKET_NAME') ??
    '';
  const keyArn =
    outputs?.AuditArchiveBucketKeyArn?.trim() ??
    readEnvValue(prodEnvContent, 'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN') ??
    '';

  console.log(`Audit archive destroy target: ${stackName}`);
  console.log(`AWS region: ${region}`);
  if (profile) {
    console.log(`AWS profile: ${profile}`);
  }
  if (bucketName) {
    console.log(`Bucket cleanup: ${bucketName}`);
  }
  if (keyArn) {
    console.log(`KMS key cleanup: ${keyArn}`);
  }

  if (!yes) {
    const confirmed = await askYesNo(
      'Fully destroy the audit archive stack and retained AWS resources?',
      false,
    );
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  }

  const deletedStack = deleteStack(stackName, region);
  if (deletedStack) {
    console.log(`Deleted stack ${stackName}.`);
  } else {
    console.log(`Stack ${stackName} was not present.`);
  }

  let bucketDeleted = false;
  if (bucketName) {
    if (bucketExists(bucketName, region)) {
      deleteBucket(bucketName, region);
      bucketDeleted = true;
      console.log(`Deleted bucket ${bucketName}.`);
    } else {
      bucketDeleted = true;
      console.log(`Bucket ${bucketName} was not present.`);
    }
  }

  if (keyArn) {
    if (!bucketDeleted && bucketName) {
      console.log(`Skipped KMS key deletion scheduling because bucket ${bucketName} still exists.`);
    } else {
      const status = scheduleKmsKeyDeletion(keyArn, region);
      if (status === 'scheduled') {
        console.log(
          `Scheduled KMS key deletion for ${keyArn} with ${MIN_KMS_PENDING_WINDOW_DAYS}-day waiting period.`,
        );
      } else if (status === 'already scheduled') {
        console.log(`KMS key deletion was already scheduled for ${keyArn}.`);
      } else {
        console.log(`KMS key ${keyArn} was not present.`);
      }
    }
  }
}

main().catch((error) => {
  console.error('\n❌ Audit archive destroy failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
