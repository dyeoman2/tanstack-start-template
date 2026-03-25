import { describe, expect, it } from 'vitest';
import {
  collectStorageBucketNames,
  getLegacyStorageBucketNames,
  getStorageDestroyEnvPath,
} from './destroy-storage';

describe('destroy-storage bucket discovery', () => {
  it('uses current stack outputs when present', () => {
    expect(
      collectStorageBucketNames({
        envContent: '',
        outputs: {
          S3QuarantineBucketName: 'quarantine-bucket',
          S3CleanBucketName: 'clean-bucket',
          S3RejectedBucketName: 'rejected-bucket',
          S3MirrorBucketName: 'mirror-bucket',
        },
        projectSlug: 'demo',
        stage: 'dev',
      }),
    ).toEqual([
      'quarantine-bucket',
      'clean-bucket',
      'rejected-bucket',
      'mirror-bucket',
      'demo-dev-files-bucket',
    ]);
  });

  it('uses env fallbacks when stack outputs are missing', () => {
    expect(
      collectStorageBucketNames({
        envContent: [
          'AWS_S3_QUARANTINE_BUCKET=env-quarantine',
          'AWS_S3_CLEAN_BUCKET=env-clean',
          'AWS_S3_REJECTED_BUCKET=env-rejected',
          'AWS_S3_MIRROR_BUCKET=env-mirror',
        ].join('\n'),
        outputs: null,
        projectSlug: 'demo',
        stage: 'prod',
      }),
    ).toEqual([
      'env-quarantine',
      'env-clean',
      'env-rejected',
      'env-mirror',
      'demo-prod-files-bucket',
    ]);
  });

  it('deduplicates mixed current and legacy names', () => {
    expect(
      collectStorageBucketNames({
        envContent: [
          'AWS_S3_QUARANTINE_BUCKET=shared-bucket',
          'AWS_S3_CLEAN_BUCKET=shared-bucket',
        ].join('\n'),
        outputs: {
          S3QuarantineBucketName: 'shared-bucket',
          S3CleanBucketName: 'shared-bucket',
        },
        projectSlug: 'demo',
        stage: 'dev',
      }),
    ).toEqual(['shared-bucket', 'demo-dev-files-bucket']);
  });

  it('keeps the legacy files bucket pattern for both stages', () => {
    expect(getLegacyStorageBucketNames('demo', 'dev')).toEqual(['demo-dev-files-bucket']);
    expect(getLegacyStorageBucketNames('demo', 'prod')).toEqual(['demo-prod-files-bucket']);
  });

  it('uses stage-specific env file paths', () => {
    expect(getStorageDestroyEnvPath('dev')).toMatch(/\.env\.local$/);
    expect(getStorageDestroyEnvPath('prod')).toMatch(/\.env\.prod$/);
  });
});
