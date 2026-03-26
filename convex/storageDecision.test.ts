import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tryFinalizeStorageDecision } from './storageDecision';

const {
  deleteStorageObjectMock,
  enqueueStorageInspectionTaskMock,
  getStorageRuntimeConfigMock,
  promoteQuarantineObjectMock,
  rejectQuarantineObjectMock,
} = vi.hoisted(() => ({
  deleteStorageObjectMock: vi.fn(async () => undefined),
  enqueueStorageInspectionTaskMock: vi.fn(async () => undefined),
  getStorageRuntimeConfigMock: vi.fn(() => ({
    fileUploadMaxBytes: 10 * 1024 * 1024,
    storageBuckets: {
      clean: { bucket: 'clean-bucket', kmsKeyArn: 'clean-kms' },
      quarantine: { bucket: 'bucket', kmsKeyArn: 'kms' },
    },
  })),
  promoteQuarantineObjectMock: vi.fn(async () => ({ VersionId: 'copied-version' })),
  rejectQuarantineObjectMock: vi.fn(async () => ({ VersionId: 'copied-version' })),
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: getStorageRuntimeConfigMock,
}));

vi.mock('./lib/storageS3', () => ({
  enqueueStorageInspectionTask: enqueueStorageInspectionTaskMock,
}));

vi.mock('./lib/storageS3Control', () => ({
  deleteStorageObject: deleteStorageObjectMock,
  promoteQuarantineObject: promoteQuarantineObjectMock,
  rejectQuarantineObject: rejectQuarantineObjectMock,
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

    expect(promoteQuarantineObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationKey: 'clean/org/org_123/chat_attachment/file_1',
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        canonicalBucket: 'clean-bucket',
        canonicalKey: 'clean/org/org_123/chat_attachment/file_1',
      }),
    );
    expect(deleteStorageObjectMock).toHaveBeenCalled();
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

    expect(rejectQuarantineObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
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

    expect(promoteQuarantineObjectMock).not.toHaveBeenCalled();
    expect(rejectQuarantineObjectMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
