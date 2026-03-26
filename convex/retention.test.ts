import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordSystemAuditEventMock = vi.fn();

vi.mock('./_generated/server', () => ({
  internalAction: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
}));

vi.mock('./_generated/api', () => ({
  internal: {
    agentChat: {
      updateAttachmentInternal: 'internal.agentChat.updateAttachmentInternal',
    },
    organizationManagement: {
      getOrganizationLegalHoldInternal:
        'internal.organizationManagement.getOrganizationLegalHoldInternal',
      getOrganizationPoliciesInternal:
        'internal.organizationManagement.getOrganizationPoliciesInternal',
    },
    pdfParse: {
      getPdfParseJobByStorageIdInternal: 'internal.pdfParse.getPdfParseJobByStorageIdInternal',
      upsertPdfParseJobInternal: 'internal.pdfParse.upsertPdfParseJobInternal',
    },
    retention: {
      listPurgeEligibleTemporaryArtifactsInternal:
        'internal.retention.listPurgeEligibleTemporaryArtifactsInternal',
      recordRetentionDeletionBatchInternal:
        'internal.retention.recordRetentionDeletionBatchInternal',
    },
    securityOps: {
      recordRetentionJob: 'internal.securityOps.recordRetentionJob',
    },
    storagePlatform: {
      deleteStoredFileInternal: 'internal.storagePlatform.deleteStoredFileInternal',
    },
  },
}));

vi.mock('./lib/auditEmitters', () => ({
  recordSystemAuditEvent: recordSystemAuditEventMock,
}));

describe('purgeExpiredTemporaryArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips organizations on legal hold and records a deletion batch', async () => {
    const retentionModule = await import('./retention');
    const handler = (retentionModule.purgeExpiredTemporaryArtifacts as any).handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<null>;
    const runQuery = vi.fn(async (ref: string, args?: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.retention.listPurgeEligibleTemporaryArtifactsInternal':
          expect(args).toMatchObject({
            limit: 128,
            now: Date.now(),
          });
          return {
            attachments: [
              {
                _id: 'attachment-1',
                kind: 'chat_attachment',
                name: 'lab-report.pdf',
                organizationId: 'org_1',
                purgeEligibleAt: Date.now() - 1_000,
                storageId: 'storage-1',
              },
            ],
            pdfParseJobs: [],
          };
        case 'internal.organizationManagement.getOrganizationLegalHoldInternal':
          return {
            id: 'hold-1',
            reason: 'Pending investigation',
            status: 'active',
          };
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 30,
          };
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.retention.recordRetentionDeletionBatchInternal':
          expect(args).toMatchObject({
            deletedCount: 0,
            failedCount: 0,
            jobKind: 'temporary_artifact_purge',
            organizationId: 'org_1',
            skippedOnHoldCount: 1,
            status: 'success',
          });
          return 'batch-1';
        case 'internal.securityOps.recordRetentionJob':
          expect(args).toMatchObject({
            jobKind: 'temporary_artifact_purge',
            processedCount: 0,
            status: 'success',
          });
          return null;
        default:
          throw new Error(`Unexpected runMutation ref: ${ref}`);
      }
    });
    const runAction = vi.fn();

    await handler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      {},
    );

    expect(runAction).not.toHaveBeenCalled();
    expect(recordSystemAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'retention_purge_skipped_on_hold',
        organizationId: 'org_1',
      }),
    );
  });

  it('deletes expired attachment artifacts and patches the attachment only', async () => {
    const retentionModule = await import('./retention');
    const handler = (retentionModule.purgeExpiredTemporaryArtifacts as any).handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<null>;
    const runQuery = vi.fn(async (ref: string) => {
      switch (ref) {
        case 'internal.retention.listPurgeEligibleTemporaryArtifactsInternal':
          return {
            attachments: [
              {
                _id: 'attachment-1',
                kind: 'chat_attachment',
                name: 'lab-report.pdf',
                organizationId: 'org_1',
                purgeEligibleAt: Date.now() - 1_000,
                storageId: 'storage-1',
              },
            ],
            pdfParseJobs: [],
          };
        case 'internal.organizationManagement.getOrganizationLegalHoldInternal':
          return null;
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 30,
          };
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.agentChat.updateAttachmentInternal':
          expect(args).toMatchObject({
            attachmentId: 'attachment-1',
            patch: expect.objectContaining({
              errorMessage: 'Attachment content expired per organization retention policy.',
              extractedTextStorageId: null,
              purgeEligibleAt: null,
              status: 'error',
            }),
          });
          return null;
        case 'internal.retention.recordRetentionDeletionBatchInternal':
          expect(args).toMatchObject({
            deletedCount: 1,
            failedCount: 0,
            skippedOnHoldCount: 0,
          });
          return 'batch-1';
        case 'internal.securityOps.recordRetentionJob':
          expect(args).toMatchObject({
            details: expect.stringContaining('deleted 1'),
            jobKind: 'temporary_artifact_purge',
            processedCount: 1,
            status: 'success',
          });
          return null;
        default:
          throw new Error(`Unexpected runMutation ref: ${ref}`);
      }
    });
    const runAction = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      if (ref !== 'internal.storagePlatform.deleteStoredFileInternal') {
        throw new Error(`Unexpected runAction ref: ${ref}`);
      }
      expect(args).toEqual({
        storageId: 'storage-1',
      });
      return null;
    });

    await handler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      {},
    );

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(
      runMutation.mock.calls.some(
        ([ref]) => String(ref).includes('chatThreads') || String(ref).includes('deleteThread'),
      ),
    ).toBe(false);
    expect(recordSystemAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'retention_purge_completed',
        organizationId: 'org_1',
      }),
    );
  });

  it('deletes expired pdf parse results and clears resultStorageId on the job', async () => {
    const retentionModule = await import('./retention');
    const handler = (retentionModule.purgeExpiredTemporaryArtifacts as any).handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<null>;
    const runQuery = vi.fn(async (ref: string, args?: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.retention.listPurgeEligibleTemporaryArtifactsInternal':
          return {
            attachments: [],
            pdfParseJobs: [
              {
                _id: 'pdf-job-1',
                organizationId: 'org_1',
                purgeEligibleAt: Date.now() - 1_000,
                resultStorageId: 'result-storage-1',
                sourceStorageId: 'source-storage-1',
              },
            ],
          };
        case 'internal.organizationManagement.getOrganizationLegalHoldInternal':
          return null;
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 45,
          };
        case 'internal.pdfParse.getPdfParseJobByStorageIdInternal':
          expect(args).toEqual({
            storageId: 'source-storage-1',
          });
          return {
            _id: 'pdf-job-1',
            completedAt: 1_710_000_000_000,
            dispatchAttempts: 1,
            dispatchErrorMessage: null,
            errorMessage: null,
            organizationId: 'org_1',
            parserVersion: 'parser-v1',
            processingStartedAt: 1_710_000_000_000,
            purgeEligibleAt: 1_710_100_000_000,
            requestedByUserId: 'user-1',
            resultStorageId: 'result-storage-1',
            status: 'ready',
            storageId: 'source-storage-1',
            updatedAt: 1_710_100_000_000,
          };
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.pdfParse.upsertPdfParseJobInternal':
          expect(args).toMatchObject({
            organizationId: 'org_1',
            purgeEligibleAt: null,
            requestedByUserId: 'user-1',
            resultStorageId: null,
            status: 'failed',
            storageId: 'source-storage-1',
          });
          return 'pdf-job-1';
        case 'internal.retention.recordRetentionDeletionBatchInternal':
          expect(args).toMatchObject({
            deletedCount: 1,
            failedCount: 0,
            skippedOnHoldCount: 0,
          });
          return 'batch-1';
        case 'internal.securityOps.recordRetentionJob':
          expect(args).toMatchObject({
            jobKind: 'temporary_artifact_purge',
            processedCount: 1,
            status: 'success',
          });
          return null;
        default:
          throw new Error(`Unexpected runMutation ref: ${ref}`);
      }
    });
    const runAction = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      if (ref !== 'internal.storagePlatform.deleteStoredFileInternal') {
        throw new Error(`Unexpected runAction ref: ${ref}`);
      }
      expect(args).toEqual({
        storageId: 'result-storage-1',
      });
      return null;
    });

    await handler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      {},
    );

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(recordSystemAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'retention_purge_completed',
        organizationId: 'org_1',
      }),
    );
  });
});
