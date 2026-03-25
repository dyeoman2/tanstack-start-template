import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryFinalizeStorageDecision } from './storageDecision';

const { copyS3ObjectMock, deleteS3ObjectMock, getStorageRuntimeConfigMock } = vi.hoisted(() => ({
  copyS3ObjectMock: vi.fn(async () => ({ VersionId: 'copied-version' })),
  deleteS3ObjectMock: vi.fn(async () => undefined),
  getStorageRuntimeConfigMock: vi.fn(() => ({
    fileUploadMaxBytes: 10 * 1024 * 1024,
    s3FilesBucket: 'bucket',
  })),
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: getStorageRuntimeConfigMock,
}));

vi.mock('./lib/storageS3', () => ({
  copyS3Object: copyS3ObjectMock,
  deleteS3Object: deleteS3ObjectMock,
  getS3Object: vi.fn(),
}));

describe('tryFinalizeStorageDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('promotes a file only after both inspection and malware verdicts pass', async () => {
    const ctx = {
      runAction: vi.fn(),
      runMutation: vi.fn(),
      runQuery: vi.fn(async () => ({
        backendMode: 's3-primary',
        inspectionScannedAt: Date.now(),
        inspectionStatus: 'PASSED',
        malwareScannedAt: Date.now(),
        malwareStatus: 'CLEAN',
        mimeType: 'application/pdf',
        organizationId: 'org_123',
        quarantineBucket: 'bucket',
        quarantineKey: 'quarantine/org/org_123/chat_attachment/file_1',
        quarantineVersionId: 'quarantine-version',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
        storagePlacement: 'QUARANTINE',
      })),
    };

    await expect(
      tryFinalizeStorageDecision(ctx as never, { storageId: 'file_1' }),
    ).resolves.toEqual({
      applied: true,
      reason: 'promoted',
    });

    expect(copyS3ObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'bucket',
        destinationKey: 'clean/org/org_123/chat_attachment/file_1',
      }),
    );
    expect(deleteS3ObjectMock).toHaveBeenCalled();
    expect(ctx.runAction).toHaveBeenCalled();
  });

  it('moves infected files into the rejected prefix', async () => {
    const ctx = {
      runAction: vi.fn(),
      runMutation: vi.fn(),
      runQuery: vi.fn(async () => ({
        backendMode: 's3-primary',
        inspectionStatus: 'PASSED',
        malwareStatus: 'INFECTED',
        mimeType: 'application/pdf',
        organizationId: 'org_123',
        quarantineBucket: 'bucket',
        quarantineKey: 'quarantine/org/org_123/chat_attachment/file_1',
        quarantineVersionId: 'quarantine-version',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
        storagePlacement: 'QUARANTINE',
      })),
    };

    await expect(
      tryFinalizeStorageDecision(ctx as never, { storageId: 'file_1' }),
    ).resolves.toEqual({
      applied: true,
      reason: 'rejected',
    });

    expect(copyS3ObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'bucket',
        destinationKey: 'rejected/org/org_123/chat_attachment/file_1',
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalled();
  });

  it('leaves files pending while either verdict is still outstanding', async () => {
    const ctx = {
      runAction: vi.fn(),
      runMutation: vi.fn(),
      runQuery: vi.fn(async () => ({
        backendMode: 's3-primary',
        inspectionStatus: 'PASSED',
        malwareStatus: 'PENDING',
        quarantineBucket: 'bucket',
        quarantineKey: 'quarantine/org/org_123/chat_attachment/file_1',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
        storagePlacement: 'QUARANTINE',
      })),
    };

    await expect(
      tryFinalizeStorageDecision(ctx as never, { storageId: 'file_1' }),
    ).resolves.toEqual({
      applied: false,
      reason: 'awaiting_verdicts',
    });

    expect(copyS3ObjectMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
