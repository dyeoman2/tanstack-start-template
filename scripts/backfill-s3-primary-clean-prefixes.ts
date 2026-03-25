#!/usr/bin/env tsx

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { buildPromotedStorageKey } from '../convex/storageS3Primary';
import { requirePnpmAndConvexCli } from './lib/cli-preflight';
import { convexExecCaptured } from './lib/convex-cli';
import { parseConvexRunStdout } from './lib/deploy-env-helpers';

type LegacyCandidate = {
  canonicalBucket: string;
  canonicalKey: string;
  canonicalVersionId: string | null;
  organizationId: string | null;
  sourceType: string;
  storageId: string;
};

type CandidatePage = {
  continueCursor: string;
  isDone: boolean;
  page: LegacyCandidate[];
};

type KeyClassification = {
  backendMode: 'convex' | 's3-primary' | 's3-mirror' | null;
  deletedAt: number | null;
  key: string;
  sourceType: string | null;
  storageId: string | null;
};

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function readFlagValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function printUsage() {
  console.log(
    'Usage: pnpm exec tsx scripts/backfill-s3-primary-clean-prefixes.ts [--apply] [--prod] [--batch-size 100] [--verify-only]',
  );
  console.log('');
  console.log(
    'Dry run by default. Use --apply to copy, patch lifecycle rows, and delete legacy objects.',
  );
}

function getBucketName() {
  const bucket = process.env.AWS_S3_FILES_BUCKET?.trim();
  if (!bucket) {
    throw new Error('AWS_S3_FILES_BUCKET must be set.');
  }
  return bucket;
}

function getAwsRegion() {
  return process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-west-1';
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeS3CopySource(bucket: string, key: string) {
  return `${bucket}/${key.split('/').map(encodeRfc3986).join('/')}`;
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function convexRunJson<T>(functionRef: string, args: Record<string, unknown>, prod: boolean): T {
  const cliArgs = ['run', functionRef, JSON.stringify(args)];
  if (prod) {
    cliArgs.push('--prod');
  }
  const output = convexExecCaptured(cliArgs);
  return JSON.parse(parseConvexRunStdout(output)) as T;
}

async function listLegacyObjects(client: S3Client, bucket: string) {
  const keys: string[] = [];

  for (const prefix of ['org/', 'site-admin/']) {
    let continuationToken: string | undefined;
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
          MaxKeys: 500,
          Prefix: prefix,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) {
          keys.push(object.Key);
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  return keys;
}

async function verifyRemainingLegacyObjects(client: S3Client, bucket: string, prod: boolean) {
  const legacyKeys = await listLegacyObjects(client, bucket);
  if (legacyKeys.length === 0) {
    return {
      remainingPrimary: [] as KeyClassification[],
      remainingUnclassified: [] as KeyClassification[],
      total: 0,
    };
  }

  const classifications: KeyClassification[] = [];
  for (const keys of chunk(legacyKeys, 50)) {
    const batch = convexRunJson<KeyClassification[]>(
      'storageLifecycle:classifyS3KeysInternal',
      {
        bucket,
        keys,
      },
      prod,
    );
    classifications.push(...batch);
  }

  return {
    remainingPrimary: classifications.filter((entry) => entry.backendMode === 's3-primary'),
    remainingUnclassified: classifications.filter((entry) => entry.backendMode === null),
    total: classifications.length,
  };
}

async function migrateCandidate(
  client: S3Client,
  candidate: LegacyCandidate,
  prod: boolean,
  apply: boolean,
) {
  const promotedKey = buildPromotedStorageKey({
    organizationId: candidate.organizationId,
    sourceType: candidate.sourceType,
    storageId: candidate.storageId,
  });

  if (!apply) {
    console.log(`DRY RUN ${candidate.storageId}: ${candidate.canonicalKey} -> ${promotedKey}`);
    return;
  }

  const copyResult = await client.send(
    new CopyObjectCommand({
      Bucket: candidate.canonicalBucket,
      CopySource: encodeS3CopySource(candidate.canonicalBucket, candidate.canonicalKey),
      Key: promotedKey,
      MetadataDirective: 'COPY',
    }),
  );

  convexRunJson(
    'storageLifecycle:markLegacyPrimaryPromotedInternal',
    {
      canonicalBucket: candidate.canonicalBucket,
      canonicalKey: promotedKey,
      canonicalVersionId: copyResult.VersionId ?? null,
      storageId: candidate.storageId,
    },
    prod,
  );

  await client.send(
    new DeleteObjectCommand({
      Bucket: candidate.canonicalBucket,
      Key: candidate.canonicalKey,
      VersionId: candidate.canonicalVersionId ?? undefined,
    }),
  );

  console.log(`MIGRATED ${candidate.storageId}: ${candidate.canonicalKey} -> ${promotedKey}`);
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  const apply = hasFlag('--apply');
  const prod = hasFlag('--prod');
  const verifyOnly = hasFlag('--verify-only');
  const batchSize = Number.parseInt(readFlagValue('--batch-size') ?? '100', 10);
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error('--batch-size must be a positive integer.');
  }

  requirePnpmAndConvexCli();

  const bucket = getBucketName();
  const client = new S3Client({
    region: getAwsRegion(),
  });

  let cursor: string | null = null;
  let processed = 0;
  let migrated = 0;

  if (!verifyOnly) {
    while (true) {
      const page: CandidatePage = convexRunJson<CandidatePage>(
        'storageLifecycle:listLegacyPrimaryCandidatesInternal',
        {
          paginationOpts: {
            cursor,
            numItems: batchSize,
          },
        },
        prod,
      );

      processed += page.page.length;
      for (const candidate of page.page) {
        await migrateCandidate(client, candidate, prod, apply);
        migrated += 1;
      }

      if (page.isDone) {
        break;
      }
      cursor = page.continueCursor;
    }
  }

  const verification = await verifyRemainingLegacyObjects(client, bucket, prod);
  const remainingCandidates = (() => {
    const firstPage = convexRunJson<CandidatePage>(
      'storageLifecycle:listLegacyPrimaryCandidatesInternal',
      {
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
      },
      prod,
    );
    return firstPage.page.length;
  })();

  console.log('');
  console.log(`Mode: ${apply ? 'apply' : verifyOnly ? 'verify-only' : 'dry-run'}`);
  console.log(`Candidates processed in this run: ${processed}`);
  console.log(`Candidates migrated in this run: ${apply ? migrated : 0}`);
  console.log(`Remaining legacy s3-primary candidates: ${remainingCandidates}`);
  console.log(`Remaining legacy-prefix objects: ${verification.total}`);
  console.log(
    `Remaining legacy-prefix s3-primary objects: ${verification.remainingPrimary.length}`,
  );
  console.log(
    `Remaining legacy-prefix unclassified objects: ${verification.remainingUnclassified.length}`,
  );

  if (verification.remainingPrimary.length > 0) {
    console.log('');
    console.log('Remaining legacy-prefix s3-primary objects:');
    for (const entry of verification.remainingPrimary.slice(0, 20)) {
      console.log(`   ${entry.key} (${entry.storageId ?? 'unknown storageId'})`);
    }
  }

  if (verification.remainingUnclassified.length > 0) {
    console.log('');
    console.log(
      'Remaining unclassified legacy-prefix objects (expected to be zero or non-s3-primary exclusions):',
    );
    for (const entry of verification.remainingUnclassified.slice(0, 20)) {
      console.log(`   ${entry.key}`);
    }
  }

  if (
    remainingCandidates === 0 &&
    verification.remainingPrimary.length === 0 &&
    verification.remainingUnclassified.length === 0
  ) {
    console.log('');
    console.log('Backfill verification passed.');
    console.log(
      'Next step: disable AWS_S3_LEGACY_PRIMARY_READS_ENABLED and redeploy the app/Convex bundle.',
    );
    console.log(
      'Then set AWS_S3_STRICT_CLEAN_PREFIX_POLICY=true for the storage stack and redeploy infra.',
    );
    return;
  }

  if (!apply && !verifyOnly) {
    console.log('');
    console.log(
      'Dry run only. Re-run with --apply once you are ready to mutate S3 and lifecycle rows.',
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
