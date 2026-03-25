#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type StackOutputs = Record<string, string>;

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
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
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
      Versions?: Array<{ Key?: string; VersionId?: string }>;
      DeleteMarkers?: Array<{ Key?: string; VersionId?: string }>;
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
  emptyBucket(bucketName, region);
  runCommand('aws', ['s3api', 'delete-bucket', '--bucket', bucketName], {
    AWS_REGION: region,
  });
}

function deleteLogGroup(logGroupName: string, region: string) {
  runCommand('aws', ['logs', 'delete-log-group', '--log-group-name', logGroupName], {
    AWS_REGION: region,
  });
}

async function main() {
  const stageIndex = process.argv.indexOf('--stage');
  const stage = stageIndex >= 0 ? process.argv[stageIndex + 1] : undefined;
  const yes = process.argv.includes('--yes');
  if (stage !== 'dev' && stage !== 'prod') {
    throw new Error('Pass --stage dev or --stage prod.');
  }

  const envContent = readEnvFile(path.join(process.cwd(), '.env.local'));
  const region =
    process.env.AWS_REGION?.trim() ?? readEnvValue(envContent, 'AWS_REGION') ?? 'us-west-1';
  const profile =
    process.env.AWS_PROFILE?.trim() ?? readEnvValue(envContent, 'AWS_PROFILE') ?? undefined;
  if (profile) {
    process.env.AWS_PROFILE = profile;
  }
  process.env.AWS_REGION = region;

  const projectSlug = process.env.AWS_STORAGE_PROJECT_SLUG?.trim() || 'tanstack-start-template';
  const stackName = `${projectSlug}-${stage}-guardduty-stack`;
  const outputs = getStackOutputs(stackName, region);
  const bucketNames = [
    outputs?.S3QuarantineBucketName ??
      (stage === 'dev' ? readEnvValue(envContent, 'AWS_S3_QUARANTINE_BUCKET') : null),
    outputs?.S3CleanBucketName ??
      (stage === 'dev' ? readEnvValue(envContent, 'AWS_S3_CLEAN_BUCKET') : null),
    outputs?.S3RejectedBucketName ??
      (stage === 'dev' ? readEnvValue(envContent, 'AWS_S3_REJECTED_BUCKET') : null),
    outputs?.S3MirrorBucketName ??
      (stage === 'dev' ? readEnvValue(envContent, 'AWS_S3_MIRROR_BUCKET') : null),
  ].filter(Boolean) as string[];
  const forwarderName =
    outputs?.GuardDutyForwarderFunctionName ?? `${projectSlug}-${stage}-guardduty-forwarder`;
  const inspectorName =
    outputs?.IngressInspectorForwarderFunctionName ??
    `${projectSlug}-${stage}-ingress-inspector-forwarder`;
  const logGroupName = `/aws/lambda/${forwarderName}`;
  const inspectorLogGroupName = `/aws/lambda/${inspectorName}`;

  console.log(`Storage destroy target: ${stackName}`);
  console.log(`AWS region: ${region}`);
  if (profile) {
    console.log(`AWS profile: ${profile}`);
  }
  if (bucketNames.length > 0) {
    console.log(`Bucket cleanup: ${bucketNames.join(', ')}`);
  }
  console.log(`Log group cleanup: ${logGroupName}, ${inspectorLogGroupName}`);

  if (!yes) {
    const confirmed = await askYesNo(
      'Fully destroy this storage stack and remove retained AWS resources?',
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

  for (const bucketName of bucketNames) {
    deleteBucket(bucketName, region);
    console.log(`Deleted bucket ${bucketName}.`);
  }

  deleteLogGroup(logGroupName, region);
  deleteLogGroup(inspectorLogGroupName, region);
  console.log(`Deleted log group ${logGroupName} if it existed.`);
  console.log(`Deleted log group ${inspectorLogGroupName} if it existed.`);
}

main().catch((error) => {
  console.error('\n❌ Storage destroy failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
