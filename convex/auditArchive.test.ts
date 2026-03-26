import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuditArchiveRuntimeConfigMock,
  getFileStorageBackendModeMock,
  headAuditArchiveObjectMock,
  getAuditArchiveObjectBytesMock,
  putAuditArchiveMetricDataMock,
  putAuditArchiveObjectMock,
  recordSystemAuditEventMock,
} = vi.hoisted(() => ({
  getAuditArchiveRuntimeConfigMock: vi.fn(() => ({
    awsRegion: 'us-west-1',
    bucket: 'audit-archive-bucket',
    kmsKeyArn: 'arn:aws:kms:us-west-1:123456789012:key/audit',
    prefix: 'audit-ledger/',
    roleArn: 'arn:aws:iam::123456789012:role/audit-archive',
  })),
  getFileStorageBackendModeMock: vi.fn(() => 's3-primary'),
  headAuditArchiveObjectMock: vi.fn(),
  getAuditArchiveObjectBytesMock: vi.fn(),
  putAuditArchiveMetricDataMock: vi.fn(),
  putAuditArchiveObjectMock: vi.fn(),
  recordSystemAuditEventMock: vi.fn(),
}));

vi.mock('../src/lib/server/env.server', () => ({
  getAuditArchiveRuntimeConfig: getAuditArchiveRuntimeConfigMock,
  getFileStorageBackendMode: getFileStorageBackendModeMock,
  isS3BackedFileStorageBackendMode: (mode: string) => mode === 's3-primary' || mode === 's3-mirror',
}));

vi.mock('./lib/auditArchiveS3', () => ({
  getAuditArchiveObjectBytes: getAuditArchiveObjectBytesMock,
  headAuditArchiveObject: headAuditArchiveObjectMock,
  putAuditArchiveMetricData: putAuditArchiveMetricDataMock,
  putAuditArchiveObject: putAuditArchiveObjectMock,
}));

vi.mock('./lib/auditEmitters', () => ({
  recordSystemAuditEvent: recordSystemAuditEventMock,
}));

import {
  exportSealedAuditLedgerSegmentToImmutableStoreInternal,
  verifyLatestSealedAuditLedgerSegmentInImmutableStoreInternal,
} from './auditArchive';

describe('audit archive export worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops when no seal exists', async () => {
    const handler = (exportSealedAuditLedgerSegmentToImmutableStoreInternal as any)._handler;
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({ chainVersion: 1, headEventHash: 'head', headSequence: 10 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
    };

    await expect(handler(ctx, {})).resolves.toEqual({
      endSequence: null,
      exported: false,
      reason: 'no_seal',
      startSequence: null,
    });

    expect(putAuditArchiveObjectMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('exports only the latest sealed range and records the watermark', async () => {
    headAuditArchiveObjectMock.mockRejectedValue({
      $metadata: { httpStatusCode: 404 },
      name: 'NotFound',
    });

    const handler = (exportSealedAuditLedgerSegmentToImmutableStoreInternal as any)._handler;
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          chainId: 'primary',
          chainVersion: 1,
          headEventHash: 'head-hash',
          headSequence: 8,
        })
        .mockResolvedValueOnce({
          chainId: 'primary',
          endSequence: 8,
          eventCount: 3,
          headHash: 'head-hash',
          sealedAt: 1700000000000,
          startSequence: 6,
        })
        .mockResolvedValueOnce({
          chainId: 'primary',
          endSequence: 5,
          eventCount: 5,
          exportedAt: 1690000000000,
          headHash: 'old-hash',
          manifestObjectKey:
            'audit-ledger/primary/000000000001-000000000005-old-hash.manifest.json',
          objectKey: 'audit-ledger/primary/000000000001-000000000005-old-hash.jsonl.gz',
          payloadSha256: 'old-payload',
          manifestSha256: 'old-manifest',
          sealedAt: 1690000000000,
          startSequence: 1,
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          continueCursor: '',
          isDone: true,
          page: [
            {
              chainId: 'primary',
              eventHash: 'hash-6',
              eventType: 'authorization_denied',
              id: 'evt-6',
              metadata: JSON.stringify({ permission: 'read', reason: 'denied' }),
              outcome: 'failure',
              previousEventHash: 'hash-5',
              provenance: { emitter: 'test', kind: 'system' },
              recordedAt: 6,
              sequence: 6,
              severity: 'warning',
              sourceSurface: 'admin.security',
            },
            {
              chainId: 'primary',
              eventHash: 'hash-7',
              eventType: 'backup_restore_drill_completed',
              id: 'evt-7',
              metadata: JSON.stringify({
                drillType: 'restore_verification',
                restoredItemCount: 3,
                verificationMethod: 'manual',
              }),
              outcome: 'success',
              previousEventHash: 'hash-6',
              provenance: { emitter: 'test', kind: 'system' },
              recordedAt: 7,
              sequence: 7,
              severity: 'info',
              sourceSurface: 'admin.security',
            },
            {
              chainId: 'primary',
              eventHash: 'hash-8',
              eventType: 'audit_log_exported',
              id: 'evt-8',
              metadata: JSON.stringify({
                exportHash: 'hash',
                exportId: 'exp-1',
                filters: {},
                manifestHash: 'manifest',
                rowCount: 3,
                scope: 'global',
              }),
              organizationId: 'org-1',
              outcome: 'success',
              previousEventHash: 'hash-7',
              provenance: { actorUserId: 'user-1', emitter: 'test', kind: 'site_admin' },
              recordedAt: 8,
              resourceId: 'exp-1',
              resourceType: 'audit_export',
              sequence: 8,
              severity: 'info',
              sourceSurface: 'admin.security',
              actorUserId: 'user-1',
            },
          ],
        }),
    };

    const result = await handler(ctx, {});

    expect(result).toEqual({
      endSequence: 8,
      exported: true,
      reason: 'exported',
      startSequence: 6,
    });
    expect(putAuditArchiveObjectMock).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bucket: 'audit-archive-bucket',
        chainId: 'primary',
        endSequence: 8,
        objectKey: expect.stringContaining('000000000006-000000000008-head-hash.jsonl.gz'),
        startSequence: 6,
      }),
    );
    expect(recordSystemAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        emitter: 'audit.archive',
        eventType: 'audit_ledger_segment_archived',
        resourceId: '6-8',
      }),
    );
  });

  it('treats pre-existing archive objects as idempotent success', async () => {
    headAuditArchiveObjectMock.mockResolvedValue({});

    const handler = (exportSealedAuditLedgerSegmentToImmutableStoreInternal as any)._handler;
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          chainId: 'primary',
          chainVersion: 1,
          headEventHash: 'head-hash',
          headSequence: 2,
        })
        .mockResolvedValueOnce({
          chainId: 'primary',
          endSequence: 2,
          eventCount: 2,
          headHash: 'head-hash',
          sealedAt: 1700000000000,
          startSequence: 1,
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          continueCursor: '',
          isDone: true,
          page: [
            {
              chainId: 'primary',
              eventHash: 'hash-1',
              eventType: 'authorization_denied',
              id: 'evt-1',
              metadata: JSON.stringify({ permission: 'read', reason: 'denied' }),
              outcome: 'failure',
              previousEventHash: null,
              provenance: { emitter: 'test', kind: 'system' },
              recordedAt: 1,
              sequence: 1,
              severity: 'warning',
              sourceSurface: 'admin.security',
            },
            {
              chainId: 'primary',
              eventHash: 'hash-2',
              eventType: 'backup_restore_drill_completed',
              id: 'evt-2',
              metadata: JSON.stringify({
                drillType: 'restore_verification',
                restoredItemCount: 1,
                verificationMethod: 'manual',
              }),
              outcome: 'success',
              previousEventHash: 'hash-1',
              provenance: { emitter: 'test', kind: 'system' },
              recordedAt: 2,
              sequence: 2,
              severity: 'info',
              sourceSurface: 'admin.security',
            },
          ],
        }),
    };

    await expect(handler(ctx, {})).resolves.toMatchObject({
      endSequence: 2,
      exported: true,
      reason: 'exported',
      startSequence: 1,
    });

    expect(putAuditArchiveObjectMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        endSequence: 2,
        startSequence: 1,
      }),
    );
  });

  it('verifies the latest sealed segment in immutable storage', async () => {
    const payloadBytes = new Uint8Array([1, 2, 3]);
    const manifestJson = JSON.stringify({
      endSequence: 8,
      headHash: 'head-hash',
      manifestObjectKey: 'audit-ledger/primary/000000000006-000000000008-head-hash.manifest.json',
      objectKey: 'audit-ledger/primary/000000000006-000000000008-head-hash.jsonl.gz',
      payloadSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      startSequence: 6,
    });
    getAuditArchiveObjectBytesMock
      .mockResolvedValueOnce(payloadBytes)
      .mockResolvedValueOnce(new TextEncoder().encode(manifestJson));
    headAuditArchiveObjectMock.mockResolvedValue({});

    const handler = (verifyLatestSealedAuditLedgerSegmentInImmutableStoreInternal as any)._handler;
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          chainId: 'primary',
          endSequence: 8,
          eventCount: 3,
          headHash: 'head-hash',
          sealedAt: 1700000000000,
          startSequence: 6,
        })
        .mockResolvedValueOnce({
          bucket: 'audit-archive-bucket',
          chainId: 'primary',
          endSequence: 8,
          eventCount: 3,
          exportedAt: 1700000000100,
          headHash: 'head-hash',
          manifestObjectKey:
            'audit-ledger/primary/000000000006-000000000008-head-hash.manifest.json',
          manifestSha256: '029f3a2c02df1b69bc6eeb3fe9c58e95d50ef1a20bb281fb33eac123c1b75445',
          objectKey: 'audit-ledger/primary/000000000006-000000000008-head-hash.jsonl.gz',
          payloadSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
          sealedAt: 1700000000000,
          startSequence: 6,
        })
        .mockResolvedValueOnce(null),
    };

    await expect(handler(ctx, {})).resolves.toMatchObject({
      driftDetected: false,
      lagCount: 0,
      lastVerificationStatus: 'verified',
      lastVerifiedSealEndSequence: 8,
      latestSealEndSequence: 8,
    });
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lastVerificationStatus: 'verified',
        latestSealEndSequence: 8,
      }),
    );
  });

  it('records a hash mismatch when immutable contents drift from the export row', async () => {
    getAuditArchiveObjectBytesMock
      .mockResolvedValueOnce(new Uint8Array([9, 9, 9]))
      .mockResolvedValueOnce(new TextEncoder().encode('{"bad":true}'));
    headAuditArchiveObjectMock.mockResolvedValue({});

    const handler = (verifyLatestSealedAuditLedgerSegmentInImmutableStoreInternal as any)._handler;
    const ctx = {
      runMutation: vi.fn(),
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          chainId: 'primary',
          endSequence: 8,
          eventCount: 3,
          headHash: 'head-hash',
          sealedAt: 1700000000000,
          startSequence: 6,
        })
        .mockResolvedValueOnce({
          bucket: 'audit-archive-bucket',
          chainId: 'primary',
          endSequence: 8,
          eventCount: 3,
          exportedAt: 1700000000100,
          headHash: 'head-hash',
          manifestObjectKey:
            'audit-ledger/primary/000000000006-000000000008-head-hash.manifest.json',
          manifestSha256: 'expected-manifest',
          objectKey: 'audit-ledger/primary/000000000006-000000000008-head-hash.jsonl.gz',
          payloadSha256: 'expected-payload',
          sealedAt: 1700000000000,
          startSequence: 6,
        })
        .mockResolvedValueOnce({
          _id: 'verification-1',
          checkedAt: 1699999999000,
          lastVerificationStatus: 'verified',
        }),
    };

    await expect(handler(ctx, {})).resolves.toMatchObject({
      driftDetected: true,
      lastVerificationStatus: 'hash_mismatch',
    });
    expect(recordSystemAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'audit_archive_verification_failed',
      }),
    );
  });
});
