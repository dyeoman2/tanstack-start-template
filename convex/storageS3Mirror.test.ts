import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileOrphanedMirrorObjects } from './storageS3Mirror';

const { deleteS3ObjectMock, listS3ObjectsMock, runtimeConfigMock } = vi.hoisted(() => ({
  deleteS3ObjectMock: vi.fn(),
  listS3ObjectsMock: vi.fn(),
  runtimeConfigMock: {
    s3FilesBucket: 'bucket',
    s3OrphanCleanupMaxScan: 50,
    s3OrphanCleanupMinAgeMs: 60_000,
  },
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: () => runtimeConfigMock,
}));

vi.mock('./lib/storageS3', () => ({
  deleteS3Object: deleteS3ObjectMock,
  listS3Objects: listS3ObjectsMock,
  putS3Object: vi.fn(),
}));

describe('reconcileOrphanedMirrorObjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const oldDate = new Date(Date.now() - 120_000);
    listS3ObjectsMock.mockImplementation(async ({ prefix }: { prefix: string }) => ({
      Contents:
        prefix === 'quarantine/'
          ? [{ Key: 'quarantine/org/acme/chat/file-1', LastModified: oldDate }]
          : prefix === 'clean/'
            ? [{ Key: 'clean/org/acme/chat/file-2', LastModified: oldDate }]
            : [{ Key: 'mirror/org/acme/chat/file-3', LastModified: oldDate }],
    }));
  });

  it('scans quarantine, clean, and mirror prefixes and deletes only orphaned keys', async () => {
    const ctx = {
      runQuery: vi.fn(async (_ref: unknown, args: { bucket: string; key: string }) => {
        if (args.key === 'clean/org/acme/chat/file-2') {
          return { deletedAt: undefined, storageId: 'file-2' };
        }
        return null;
      }),
    };

    await reconcileOrphanedMirrorObjects(ctx as never);

    expect(listS3ObjectsMock).toHaveBeenCalledTimes(3);
    expect(listS3ObjectsMock).toHaveBeenCalledWith({
      bucket: 'bucket',
      maxKeys: 50,
      prefix: 'quarantine/',
    });
    expect(listS3ObjectsMock).toHaveBeenCalledWith({
      bucket: 'bucket',
      maxKeys: 50,
      prefix: 'clean/',
    });
    expect(listS3ObjectsMock).toHaveBeenCalledWith({
      bucket: 'bucket',
      maxKeys: 50,
      prefix: 'mirror/',
    });

    expect(deleteS3ObjectMock).toHaveBeenCalledTimes(2);
    expect(deleteS3ObjectMock).toHaveBeenCalledWith({
      bucket: 'bucket',
      key: 'quarantine/org/acme/chat/file-1',
    });
    expect(deleteS3ObjectMock).toHaveBeenCalledWith({
      bucket: 'bucket',
      key: 'mirror/org/acme/chat/file-3',
    });
  });
});
