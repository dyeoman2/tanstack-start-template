import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileOrphanedMirrorObjects } from './storageS3Mirror';

const { deleteStorageObjectMock, listStorageObjectsMock, runtimeConfigMock } = vi.hoisted(() => ({
  deleteStorageObjectMock: vi.fn(),
  listStorageObjectsMock: vi.fn(),
  runtimeConfigMock: {
    s3OrphanCleanupMaxScan: 50,
    s3OrphanCleanupMinAgeMs: 60_000,
    storageBuckets: {
      clean: { bucket: 'clean-bucket', kmsKeyArn: 'clean-kms' },
      mirror: { bucket: 'mirror-bucket', kmsKeyArn: 'mirror-kms' },
      quarantine: { bucket: 'quarantine-bucket', kmsKeyArn: 'quarantine-kms' },
      rejected: { bucket: 'rejected-bucket', kmsKeyArn: 'rejected-kms' },
    },
  },
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: () => runtimeConfigMock,
}));

vi.mock('./lib/storageS3', () => ({
  deleteStorageObject: deleteStorageObjectMock,
  listStorageObjects: listStorageObjectsMock,
  putMirrorObject: vi.fn(),
}));

describe('reconcileOrphanedMirrorObjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const oldDate = new Date(Date.now() - 120_000);
    listStorageObjectsMock.mockImplementation(async ({ prefix }: { prefix: string }) => ({
      Contents:
        prefix === 'quarantine/'
          ? [{ Key: 'quarantine/org/acme/chat/file-1', LastModified: oldDate }]
          : prefix === 'clean/'
            ? [{ Key: 'clean/org/acme/chat/file-2', LastModified: oldDate }]
            : prefix === 'mirror/'
              ? [{ Key: 'mirror/org/acme/chat/file-3', LastModified: oldDate }]
              : [],
    }));
  });

  it('scans configured storage buckets and deletes only orphaned keys', async () => {
    const ctx = {
      runQuery: vi.fn(async (_ref: unknown, args: { bucket: string; key: string }) => {
        if (args.bucket === 'clean-bucket' && args.key === 'clean/org/acme/chat/file-2') {
          return { deletedAt: undefined, storageId: 'file-2' };
        }
        return null;
      }),
    };

    await reconcileOrphanedMirrorObjects(ctx as never);

    expect(listStorageObjectsMock).toHaveBeenCalledTimes(4);
    expect(listStorageObjectsMock).toHaveBeenCalledWith({
      bucketKind: 'quarantine',
      maxKeys: 50,
      prefix: 'quarantine/',
    });
    expect(listStorageObjectsMock).toHaveBeenCalledWith({
      bucketKind: 'clean',
      maxKeys: 50,
      prefix: 'clean/',
    });
    expect(listStorageObjectsMock).toHaveBeenCalledWith({
      bucketKind: 'mirror',
      maxKeys: 50,
      prefix: 'mirror/',
    });
    expect(listStorageObjectsMock).toHaveBeenCalledWith({
      bucketKind: 'rejected',
      maxKeys: 50,
      prefix: 'rejected/',
    });

    expect(deleteStorageObjectMock).toHaveBeenCalledTimes(2);
    expect(deleteStorageObjectMock).toHaveBeenCalledWith({
      bucketKind: 'quarantine',
      key: 'quarantine/org/acme/chat/file-1',
    });
    expect(deleteStorageObjectMock).toHaveBeenCalledWith({
      bucketKind: 'mirror',
      key: 'mirror/org/acme/chat/file-3',
    });
  });
});
