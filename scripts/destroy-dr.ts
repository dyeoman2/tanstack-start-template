#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { buildDrSecretNames, parseGitHubRepoFromRemote } from './lib/setup-dr';

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type NetlifySite = {
  id: string;
  name: string;
};

type StackOutputs = Record<string, string>;

type StackResource = {
  LogicalResourceId?: string;
  PhysicalResourceId?: string;
  ResourceType?: string;
};

type DbClusterSnapshot = {
  DBClusterSnapshotIdentifier?: string;
};

const DEFAULT_PROJECT_SLUG = 'tanstack-start-template';
const DR_ENV_FILE_NAME = '.dr.env.local';

const loadEnvFile = process.loadEnvFile?.bind(process);
if (loadEnvFile) {
  for (const fileName of ['.env', '.env.local', DR_ENV_FILE_NAME]) {
    const filePath = path.join(process.cwd(), fileName);
    if (existsSync(filePath)) {
      loadEnvFile(filePath);
    }
  }
}

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

function ensureOk(result: CommandResult, message: string) {
  if (!result.ok) {
    const details = [result.stdout, result.stderr].join('\n').trim();
    throw new Error(details ? `${message}\n${details}` : message);
  }
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

function readEnvFile(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function readEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = Array.from(envContent.matchAll(new RegExp(`^${escapedName}=(.*)$`, 'gm')));
  const match = matches.at(-1);
  return match?.[1]?.trim()?.replace(/^"(.*)"$/, '$1') || null;
}

function removeEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return envContent.replace(new RegExp(`^${escapedName}=.*(?:\n|$)`, 'm'), '');
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

function getStackResources(stackName: string, region: string) {
  const result = runCommand(
    'aws',
    [
      'cloudformation',
      'list-stack-resources',
      '--stack-name',
      stackName,
      '--query',
      'StackResourceSummaries',
      '--output',
      'json',
    ],
    { AWS_REGION: region },
  );
  return parseJson<StackResource[]>(result) ?? [];
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
  if (!bucketExists(bucketName, region)) {
    return false;
  }

  emptyBucket(bucketName, region);
  runCommand('aws', ['s3api', 'delete-bucket', '--bucket', bucketName], {
    AWS_REGION: region,
  });
  return !bucketExists(bucketName, region);
}

function listIamAccessKeys(userName: string, region: string) {
  const result = runCommand(
    'aws',
    [
      'iam',
      'list-access-keys',
      '--user-name',
      userName,
      '--query',
      'AccessKeyMetadata[].AccessKeyId',
      '--output',
      'json',
    ],
    { AWS_REGION: region },
  );
  return parseJson<string[]>(result) ?? [];
}

function deleteIamAccessKeys(userName: string, region: string) {
  for (const accessKeyId of listIamAccessKeys(userName, region)) {
    runCommand(
      'aws',
      ['iam', 'delete-access-key', '--user-name', userName, '--access-key-id', accessKeyId],
      { AWS_REGION: region },
    );
  }
}

function secretExists(secretId: string, region: string) {
  return runCommand(
    'aws',
    ['secretsmanager', 'describe-secret', '--secret-id', secretId, '--output', 'json'],
    { AWS_REGION: region },
  ).ok;
}

function deleteSecret(secretId: string, region: string) {
  if (!secretExists(secretId, region)) {
    return false;
  }

  runCommand(
    'aws',
    ['secretsmanager', 'delete-secret', '--secret-id', secretId, '--force-delete-without-recovery'],
    { AWS_REGION: region },
  );
  return true;
}

function listManualDbClusterSnapshots(clusterIdentifier: string, region: string) {
  const result = runCommand(
    'aws',
    [
      'rds',
      'describe-db-cluster-snapshots',
      '--snapshot-type',
      'manual',
      '--db-cluster-identifier',
      clusterIdentifier,
      '--query',
      'DBClusterSnapshots[].{DBClusterSnapshotIdentifier:DBClusterSnapshotIdentifier}',
      '--output',
      'json',
    ],
    { AWS_REGION: region },
  );
  return parseJson<DbClusterSnapshot[]>(result) ?? [];
}

function deleteDbClusterSnapshots(clusterIdentifier: string, region: string) {
  for (const snapshot of listManualDbClusterSnapshots(clusterIdentifier, region)) {
    const snapshotId = snapshot.DBClusterSnapshotIdentifier?.trim();
    if (!snapshotId) {
      continue;
    }

    runCommand(
      'aws',
      ['rds', 'delete-db-cluster-snapshot', '--db-cluster-snapshot-identifier', snapshotId],
      { AWS_REGION: region },
    );
  }
}

function listNetlifySites() {
  const result = runCommand('netlify', ['sites:list', '--json']);
  const parsed = parseJson<Array<{ id?: string; name?: string }>>(result) ?? [];
  return parsed.flatMap((site) =>
    site.id && site.name
      ? [
          {
            id: site.id,
            name: site.name,
          } satisfies NetlifySite,
        ]
      : [],
  );
}

function findNetlifySiteByName(name: string) {
  return listNetlifySites().find((site) => site.name === name) ?? null;
}

function deleteNetlifySite(siteId: string) {
  return runCommand('netlify', ['sites:delete', '--force', siteId]).ok;
}

function getGitHubRepoFromOrigin() {
  const remote = runCommand('git', ['remote', 'get-url', 'origin']).stdout.trim();
  return remote ? parseGitHubRepoFromRemote(remote) : null;
}

function deleteGitHubSecret(repo: string, name: string) {
  runCommand('gh', ['secret', 'delete', name, '--repo', repo, '--app', 'actions']);
}

function cleanupLegacyDrVarsInEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) {
    return;
  }

  let envContent = readFileSync(envPath, 'utf8');
  for (const name of [
    'AWS_DR_PROJECT_SLUG',
    'AWS_DR_HOSTNAME_STRATEGY',
    'AWS_DR_BACKUP_S3_BUCKET',
    'AWS_DR_STACK_NAME',
    'AWS_DR_ECS_CPU',
    'AWS_DR_ECS_MEMORY_MIB',
    'AWS_DR_DOMAIN',
    'AWS_DR_BACKEND_SUBDOMAIN',
    'AWS_DR_FRONTEND_SUBDOMAIN',
    'AWS_DR_SITE_SUBDOMAIN',
  ]) {
    envContent = removeEnvValue(envContent, name);
  }
  writeFileSync(envPath, envContent, 'utf8');
}

async function main() {
  const stackIndex = process.argv.indexOf('--stack');
  const target = stackIndex >= 0 ? process.argv[stackIndex + 1] : undefined;
  const yes = process.argv.includes('--yes');
  if (target !== 'backup' && target !== 'ecs' && target !== 'all') {
    throw new Error('Pass --stack backup, --stack ecs, or --stack all.');
  }

  const envContent = readEnvFile(path.join(process.cwd(), '.env.local'));
  const drEnvContent = readEnvFile(path.join(process.cwd(), DR_ENV_FILE_NAME));
  const region =
    process.env.AWS_REGION?.trim() ?? readEnvValue(envContent, 'AWS_REGION') ?? 'us-west-1';
  const profile =
    process.env.AWS_PROFILE?.trim() ?? readEnvValue(envContent, 'AWS_PROFILE') ?? undefined;
  if (profile) {
    process.env.AWS_PROFILE = profile;
  }
  process.env.AWS_REGION = region;

  const projectSlug =
    process.env.AWS_DR_PROJECT_SLUG?.trim() ??
    readEnvValue(drEnvContent, 'AWS_DR_PROJECT_SLUG') ??
    DEFAULT_PROJECT_SLUG;
  const backupStackName = `${projectSlug}-dr-backup-stack`;
  const ecsStackName =
    process.env.AWS_DR_STACK_NAME?.trim() ??
    readEnvValue(drEnvContent, 'AWS_DR_STACK_NAME') ??
    `${projectSlug}-dr-ecs-stack`;
  const netlifySiteName = `${projectSlug}-dr`;
  const githubRepo = getGitHubRepoFromOrigin();
  const secretNames = buildDrSecretNames(projectSlug);

  const backupOutputs = target === 'ecs' ? null : getStackOutputs(backupStackName, region);
  const backupBucketName =
    backupOutputs?.DrBackupBucketName ??
    process.env.AWS_DR_BACKUP_S3_BUCKET?.trim() ??
    readEnvValue(drEnvContent, 'AWS_DR_BACKUP_S3_BUCKET');
  const backupUserName = backupOutputs?.DrBackupCiUserName ?? `${projectSlug}-dr-backup-ci-user`;
  const ecsResources = target === 'backup' ? [] : getStackResources(ecsStackName, region);
  const dbClusterId =
    ecsResources.find((resource) => resource.LogicalResourceId === 'DrAuroraCluster')
      ?.PhysicalResourceId ?? null;

  console.log(`DR destroy target: ${target}`);
  console.log(`AWS region: ${region}`);
  if (profile) {
    console.log(`AWS profile: ${profile}`);
  }
  console.log(`Project slug: ${projectSlug}`);
  if (target === 'backup' || target === 'all') {
    console.log(`Backup stack: ${backupStackName}`);
    if (backupBucketName) {
      console.log(`Backup bucket cleanup: ${backupBucketName}`);
    }
    console.log(`Backup CI user cleanup: ${backupUserName}`);
  }
  if (target === 'ecs' || target === 'all') {
    console.log(`ECS stack: ${ecsStackName}`);
    if (dbClusterId) {
      console.log(`Aurora snapshot cleanup source: ${dbClusterId}`);
    }
  }
  if (target === 'all') {
    console.log(`Netlify DR site cleanup: ${netlifySiteName}`);
    if (githubRepo) {
      console.log(`GitHub Actions secret cleanup: ${githubRepo}`);
    }
    console.log(`DR secret cleanup: ${Object.values(secretNames).join(', ')}`);
    console.log(`Repo-local DR defaults cleanup: ${DR_ENV_FILE_NAME}`);
  }

  if (!yes) {
    const confirmed = await askYesNo(
      'Fully destroy these DR resources and external DR artifacts?',
      false,
    );
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  }

  if (target === 'backup' || target === 'all') {
    deleteIamAccessKeys(backupUserName, region);
    if (backupBucketName && bucketExists(backupBucketName, region)) {
      emptyBucket(backupBucketName, region);
      console.log(`Emptied bucket ${backupBucketName}.`);
    }

    const deletedStack = deleteStack(backupStackName, region);
    console.log(
      deletedStack
        ? `Deleted stack ${backupStackName}.`
        : `Stack ${backupStackName} was not present.`,
    );

    if (backupBucketName) {
      deleteBucket(backupBucketName, region);
      console.log(`Deleted bucket ${backupBucketName} if it remained.`);
    }
  }

  if (target === 'ecs' || target === 'all') {
    const deletedStack = deleteStack(ecsStackName, region);
    console.log(
      deletedStack ? `Deleted stack ${ecsStackName}.` : `Stack ${ecsStackName} was not present.`,
    );

    if (dbClusterId) {
      deleteDbClusterSnapshots(dbClusterId, region);
      console.log(`Deleted manual Aurora snapshots for ${dbClusterId} if any existed.`);
    }
  }

  if (target === 'all') {
    const secretsToDelete = [
      ...Object.values(secretNames),
      `${projectSlug}-dr-aurora-credentials-secret`,
      `${projectSlug}-dr-convex-instance-secret`,
    ] as string[];

    for (const secretId of secretsToDelete) {
      if (deleteSecret(secretId, region)) {
        console.log(`Deleted secret ${secretId}.`);
      }
    }

    const netlifySite = findNetlifySiteByName(netlifySiteName);
    if (netlifySite && deleteNetlifySite(netlifySite.id)) {
      console.log(`Deleted Netlify site ${netlifySiteName}.`);
    } else if (netlifySite) {
      console.log(`Netlify site ${netlifySiteName} still exists; delete it manually if needed.`);
    }

    if (githubRepo) {
      for (const secretName of [
        'AWS_DR_BACKUP_ACCESS_KEY_ID',
        'AWS_DR_BACKUP_SECRET_ACCESS_KEY',
        'AWS_DR_BACKUP_REGION',
        'AWS_DR_BACKUP_S3_BUCKET',
        'DR_TEST_APP_NAME',
        'DR_TEST_APP_URL',
        'DR_TEST_BETTER_AUTH_SECRET',
        'DR_TEST_BETTER_AUTH_URL',
        'DR_TEST_CONVEX_SITE_URL',
        'DR_TEST_JWKS',
      ]) {
        deleteGitHubSecret(githubRepo, secretName);
      }
      console.log(`Deleted DR-specific GitHub Actions secrets from ${githubRepo} if they existed.`);
    }

    const drEnvPath = path.join(process.cwd(), DR_ENV_FILE_NAME);
    if (existsSync(drEnvPath)) {
      rmSync(drEnvPath, { force: true });
      console.log(`Deleted ${DR_ENV_FILE_NAME}.`);
    }
    cleanupLegacyDrVarsInEnvLocal();
  }
}

main().catch((error) => {
  console.error('\n❌ DR destroy failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
