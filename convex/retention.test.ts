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
      deleteAttachmentStorageInternal: 'internal.agentChat.deleteAttachmentStorageInternal',
      deleteThreadForCleanupInternal: 'internal.agentChat.deleteThreadForCleanupInternal',
      getAttachmentByStorageIdInternal: 'internal.agentChat.getAttachmentByStorageIdInternal',
    },
    organizationManagement: {
      getOrganizationPoliciesInternal:
        'internal.organizationManagement.getOrganizationPoliciesInternal',
    },
    pdfParse: {
      deletePdfParseJobInternal: 'internal.pdfParse.deletePdfParseJobInternal',
      getPdfParseJobByStorageIdInternal: 'internal.pdfParse.getPdfParseJobByStorageIdInternal',
    },
    retention: {
      getOrganizationHoldAwareOperationDecisionInternal:
        'internal.retention.getOrganizationHoldAwareOperationDecisionInternal',
      listPurgeEligibleChatThreadsInternal:
        'internal.retention.listPurgeEligibleChatThreadsInternal',
      listPurgeEligiblePdfParseJobsInternal:
        'internal.retention.listPurgeEligiblePdfParseJobsInternal',
      listPurgeEligibleStandaloneAttachmentsInternal:
        'internal.retention.listPurgeEligibleStandaloneAttachmentsInternal',
      listThreadAttachmentsForRetentionInternal:
        'internal.retention.listThreadAttachmentsForRetentionInternal',
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

describe('retention policy helpers', () => {
  it('blocks destructive operations during an active hold and allows exports', async () => {
    const retentionModule = await import('./retention');
    const handler = (retentionModule.getOrganizationHoldAwareOperationDecisionInternal as any)
      .handler as (ctx: unknown, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    const query = vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        unique: vi.fn().mockResolvedValue({
          _id: 'hold-1',
          reason: 'Preserve records',
          status: 'active',
        }),
      }),
    });

    const deleteDecision = await handler(
      {
        db: {
          query,
        },
      } as never,
      {
        operation: 'delete',
        organizationId: 'org-1',
        resourceType: 'chat_thread',
      },
    );
    const exportDecision = await handler(
      {
        db: {
          query,
        },
      } as never,
      {
        allowExportDuringHold: true,
        operation: 'export',
        organizationId: 'org-1',
        resourceType: 'audit_export',
      },
    );

    expect(deleteDecision).toMatchObject({
      allowed: false,
      legalHoldActive: true,
      legalHoldId: 'hold-1',
      normalizedLegalHoldReason: 'active_legal_hold',
      retentionScopeVersion: 'full_phi_record_set_v2',
    });
    expect(exportDecision).toMatchObject({
      allowed: true,
      legalHoldActive: true,
      legalHoldId: 'hold-1',
      resourceType: 'audit_export',
    });
  });
});

describe('purgeExpiredTemporaryArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips organizations on legal hold and records a v2 retention batch', async () => {
    const retentionModule = await import('./retention');
    const handler = (retentionModule.purgeExpiredTemporaryArtifacts as any).handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<null>;

    const runQuery = vi.fn(async (ref: string) => {
      switch (ref) {
        case 'internal.retention.listPurgeEligibleChatThreadsInternal':
          return [
            {
              _id: 'thread-1',
              organizationId: 'org_1',
              purgeEligibleAt: Date.now() - 1_000,
              title: 'Lab review',
            },
          ];
        case 'internal.retention.listPurgeEligibleStandaloneAttachmentsInternal':
        case 'internal.retention.listPurgeEligiblePdfParseJobsInternal':
          return [];
        case 'internal.retention.getOrganizationHoldAwareOperationDecisionInternal':
          return {
            allowed: false,
            legalHoldActive: true,
            legalHoldId: 'hold-1',
            legalHoldReason: 'Pending investigation',
            normalizedLegalHoldReason: 'active_legal_hold',
            operation: 'purge',
            resourceId: null,
            resourceType: 'chat_thread_record_set',
            retentionScopeVersion: 'full_phi_record_set_v2',
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
            jobKind: 'phi_record_purge',
            organizationId: 'org_1',
            skippedOnHoldCount: 1,
            status: 'success',
          });
          expect(JSON.parse(String(args.policySnapshotJson))).toMatchObject({
            legalHoldId: 'hold-1',
            legalHoldStatus: 'active',
            retentionScope: 'full_phi_record_set_v2',
          });
          return 'batch-1';
        case 'internal.securityOps.recordRetentionJob':
          expect(args).toMatchObject({
            jobKind: 'phi_record_purge',
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
        sourceSurface: 'retention.phi_record_purge',
      }),
    );
  });

  it('purges a full thread record set and dependent parse artifacts', async () => {
    const retentionModule = await import('./retention');
    const handler = (retentionModule.purgeExpiredTemporaryArtifacts as any).handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<null>;

    const runQuery = vi.fn(async (ref: string, args?: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.retention.listPurgeEligibleChatThreadsInternal':
          return [
            {
              _id: 'thread-1',
              organizationId: 'org_1',
              purgeEligibleAt: Date.now() - 1_000,
              title: 'Lab review',
            },
          ];
        case 'internal.retention.listPurgeEligibleStandaloneAttachmentsInternal':
        case 'internal.retention.listPurgeEligiblePdfParseJobsInternal':
          return [];
        case 'internal.retention.getOrganizationHoldAwareOperationDecisionInternal':
          return {
            allowed: true,
            legalHoldActive: false,
            legalHoldId: null,
            legalHoldReason: null,
            normalizedLegalHoldReason: null,
            operation: 'purge',
            resourceId: null,
            resourceType: 'chat_thread_record_set',
            retentionScopeVersion: 'full_phi_record_set_v2',
          };
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 30,
          };
        case 'internal.retention.listThreadAttachmentsForRetentionInternal':
          expect(args).toEqual({
            threadId: 'thread-1',
          });
          return [
            {
              _id: 'attachment-1',
              extractedTextStorageId: 'extract-1',
              name: 'lab-report.pdf',
              organizationId: 'org_1',
              storageId: 'storage-1',
            },
          ];
        case 'internal.pdfParse.getPdfParseJobByStorageIdInternal':
          expect(args).toEqual({
            storageId: 'storage-1',
          });
          return {
            _id: 'pdf-job-1',
            organizationId: 'org_1',
            resultStorageId: 'result-1',
            storageId: 'storage-1',
          };
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.pdfParse.deletePdfParseJobInternal':
          expect(args).toEqual({
            jobId: 'pdf-job-1',
          });
          return null;
        case 'internal.agentChat.deleteThreadForCleanupInternal':
          expect(args).toEqual({
            threadId: 'thread-1',
          });
          return {
            deleted: true,
            organizationId: 'org_1',
          };
        case 'internal.retention.recordRetentionDeletionBatchInternal':
          expect(args).toMatchObject({
            deletedCount: 1,
            failedCount: 0,
            jobKind: 'phi_record_purge',
            skippedOnHoldCount: 0,
          });
          return 'batch-1';
        case 'internal.securityOps.recordRetentionJob':
          expect(args).toMatchObject({
            details: expect.stringContaining('deleted 1'),
            jobKind: 'phi_record_purge',
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
      return args;
    });

    await handler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      {},
    );

    expect(runAction.mock.calls).toEqual([
      ['internal.storagePlatform.deleteStoredFileInternal', { storageId: 'storage-1' }],
      ['internal.storagePlatform.deleteStoredFileInternal', { storageId: 'extract-1' }],
      ['internal.storagePlatform.deleteStoredFileInternal', { storageId: 'result-1' }],
    ]);
    expect(recordSystemAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'retention_purge_completed',
        organizationId: 'org_1',
      }),
    );
  });

  it('purges standalone attachments and independent pdf jobs under the v2 scope', async () => {
    const retentionModule = await import('./retention');
    const handler = (retentionModule.purgeExpiredTemporaryArtifacts as any).handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<null>;

    const runQuery = vi.fn(async (ref: string, args?: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.retention.listPurgeEligibleChatThreadsInternal':
          return [];
        case 'internal.retention.listPurgeEligibleStandaloneAttachmentsInternal':
          return [
            {
              _id: 'attachment-1',
              extractedTextStorageId: 'extract-1',
              name: 'lab-report.pdf',
              organizationId: 'org_1',
              purgeEligibleAt: Date.now() - 1_000,
              storageId: 'storage-1',
            },
          ];
        case 'internal.retention.listPurgeEligiblePdfParseJobsInternal':
          return [
            {
              _id: 'pdf-job-2',
              organizationId: 'org_1',
              purgeEligibleAt: Date.now() - 1_000,
              resultStorageId: 'result-2',
              sourceStorageId: 'source-2',
            },
          ];
        case 'internal.retention.getOrganizationHoldAwareOperationDecisionInternal':
          return {
            allowed: true,
            legalHoldActive: false,
            legalHoldId: null,
            legalHoldReason: null,
            normalizedLegalHoldReason: null,
            operation: 'purge',
            resourceId: null,
            resourceType: 'chat_thread_record_set',
            retentionScopeVersion: 'full_phi_record_set_v2',
          };
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 45,
          };
        case 'internal.pdfParse.getPdfParseJobByStorageIdInternal':
          if (args?.storageId === 'storage-1') {
            return null;
          }
          if (args?.storageId === 'source-2') {
            return {
              _id: 'pdf-job-2',
              organizationId: 'org_1',
              resultStorageId: 'result-2',
              storageId: 'source-2',
            };
          }
          throw new Error(`Unexpected storageId: ${String(args?.storageId)}`);
        case 'internal.agentChat.getAttachmentByStorageIdInternal':
          expect(args).toEqual({
            storageId: 'source-2',
          });
          return null;
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.agentChat.deleteAttachmentStorageInternal':
          expect(args).toEqual({
            attachmentId: 'attachment-1',
          });
          return null;
        case 'internal.pdfParse.deletePdfParseJobInternal':
          expect(args).toEqual({
            jobId: 'pdf-job-2',
          });
          return null;
        case 'internal.retention.recordRetentionDeletionBatchInternal':
          expect(args).toMatchObject({
            deletedCount: 2,
            failedCount: 0,
            jobKind: 'phi_record_purge',
            skippedOnHoldCount: 0,
          });
          return 'batch-1';
        case 'internal.securityOps.recordRetentionJob':
          expect(args).toMatchObject({
            details: expect.stringContaining('deleted 2'),
            jobKind: 'phi_record_purge',
            processedCount: 2,
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
      return args;
    });

    await handler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      {},
    );

    expect(runAction.mock.calls).toEqual([
      ['internal.storagePlatform.deleteStoredFileInternal', { storageId: 'storage-1' }],
      ['internal.storagePlatform.deleteStoredFileInternal', { storageId: 'extract-1' }],
      ['internal.storagePlatform.deleteStoredFileInternal', { storageId: 'result-2' }],
      ['internal.storagePlatform.deleteStoredFileInternal', { storageId: 'source-2' }],
    ]);
  });
});
