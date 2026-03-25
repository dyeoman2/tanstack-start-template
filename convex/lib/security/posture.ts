import type { QueryCtx } from '../../_generated/server';
import { getRetentionPolicyConfig } from '../../../src/lib/server/security-config.server';
import { getVendorBoundarySnapshot } from '../../../src/lib/server/vendor-boundary.server';
import { ALWAYS_ON_REGULATED_BASELINE } from '../../../src/lib/shared/security-baseline';
import { getVerifiedCurrentSiteAdminUserOrThrow } from '../../auth/access';
import { fetchAllBetterAuthPasskeys, fetchAllBetterAuthUsers } from '../betterAuth';
import { normalizeSecurityScope } from './core';
import { _getSecurityMetricsSnapshot, countQueryResults } from './operations_core';

export async function getSecurityPostureSummaryHandler(ctx: QueryCtx) {
  await getVerifiedCurrentSiteAdminUserOrThrow(ctx);

  const metrics = await _getSecurityMetricsSnapshot(ctx);
  const [
    authUsers,
    passkeys,
    latestRetentionJob,
    latestBackupCheck,
    latestAuditEvent,
    latestImmutableExport,
    integrityFailures,
  ] = await Promise.all([
    fetchAllBetterAuthUsers(ctx),
    fetchAllBetterAuthPasskeys(ctx),
    ctx.db.query('retentionJobs').withIndex('by_created_at').order('desc').first(),
    ctx.db.query('backupVerificationReports').withIndex('by_checked_at').order('desc').first(),
    ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_recordedAt', (q) => q.eq('chainId', 'primary'))
      .order('desc')
      .first(),
    ctx.db
      .query('auditLedgerImmutableExports')
      .withIndex('by_chain_id_and_exported_at', (q) => q.eq('chainId', 'primary'))
      .order('desc')
      .first(),
    countQueryResults(
      ctx.db
        .query('auditLedgerCheckpoints')
        .withIndex('by_chain_id_and_status_and_checked_at', (q) =>
          q.eq('chainId', 'primary').eq('status', 'failed'),
        ),
    ),
  ]);

  const totalUsers = authUsers.length;
  const usersWithPasskeys = new Set(
    passkeys
      .map((passkey) => passkey.userId)
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
  );
  const mfaEnabledUsers = authUsers.filter(
    (user) => user.twoFactorEnabled === true || usersWithPasskeys.has(user._id),
  ).length;
  const passkeyEnabledUsers = authUsers.filter((user) => usersWithPasskeys.has(user._id)).length;
  const retentionPolicy = getRetentionPolicyConfig();
  const vendorPosture = getVendorBoundarySnapshot();
  const sentryPosture = vendorPosture.find((vendor) => vendor.vendor === 'sentry');

  return {
    audit: {
      integrityFailures,
      lastEventAt: latestAuditEvent?.recordedAt ?? null,
      lastImmutableExportAt: latestImmutableExport?.exportedAt ?? null,
    },
    auth: {
      emailVerificationRequired: ALWAYS_ON_REGULATED_BASELINE.requireVerifiedEmail,
      mfaCoveragePercent: totalUsers === 0 ? 0 : Math.round((mfaEnabledUsers / totalUsers) * 100),
      mfaEnabledUsers,
      passkeyEnabledUsers,
      totalUsers,
    },
    backups: {
      lastCheckedAt: latestBackupCheck?.checkedAt ?? null,
      lastStatus: latestBackupCheck?.status ?? null,
    },
    retention: {
      lastJobAt: latestRetentionJob?.createdAt ?? null,
      lastJobStatus: latestRetentionJob?.status ?? null,
    },
    scanner: {
      lastScanAt: metrics.lastDocumentScanAt,
      quarantinedCount: metrics.quarantinedDocumentScans,
      rejectedCount: metrics.rejectedDocumentScans,
      totalScans: metrics.totalDocumentScans,
    },
    sessions: {
      freshWindowMinutes: retentionPolicy.recentStepUpWindowMinutes,
      sessionExpiryHours: 24,
      temporaryLinkTtlMinutes: retentionPolicy.attachmentUrlTtlMinutes,
    },
    telemetry: {
      sentryApproved: sentryPosture?.approved ?? false,
      sentryEnabled: (sentryPosture?.approved ?? false) && Boolean(process.env.VITE_SENTRY_DSN),
    },
    vendors: vendorPosture,
  };
}

export async function getAuditReadinessSnapshotHandler(ctx: QueryCtx) {
  const [
    auditLedgerState,
    latestBackupDrill,
    latestCheckpoint,
    latestRetentionJob,
    latestSuccessfulCheckpoint,
    latestFailedCheckpoint,
    latestImmutableExport,
    latestSeal,
    sealCount,
    recentAuditLogs,
    recentExports,
  ] = await Promise.all([
    ctx.db
      .query('auditLedgerState')
      .withIndex('by_chain_id', (q) => q.eq('chainId', 'primary'))
      .first(),
    ctx.db.query('backupVerificationReports').withIndex('by_checked_at').order('desc').first(),
    ctx.db
      .query('auditLedgerCheckpoints')
      .withIndex('by_chain_id_and_checked_at', (q) => q.eq('chainId', 'primary'))
      .order('desc')
      .first(),
    ctx.db.query('retentionJobs').withIndex('by_created_at').order('desc').first(),
    ctx.db
      .query('auditLedgerCheckpoints')
      .withIndex('by_chain_id_and_status_and_checked_at', (q) =>
        q.eq('chainId', 'primary').eq('status', 'ok'),
      )
      .order('desc')
      .first(),
    ctx.db
      .query('auditLedgerCheckpoints')
      .withIndex('by_chain_id_and_status_and_checked_at', (q) =>
        q.eq('chainId', 'primary').eq('status', 'failed'),
      )
      .order('desc')
      .first(),
    ctx.db
      .query('auditLedgerImmutableExports')
      .withIndex('by_chain_id_and_end_sequence', (q) => q.eq('chainId', 'primary'))
      .order('desc')
      .first(),
    ctx.db
      .query('auditLedgerSeals')
      .withIndex('by_chain_id_and_sealed_at', (q) => q.eq('chainId', 'primary'))
      .order('desc')
      .first(),
    countQueryResults(
      ctx.db
        .query('auditLedgerSeals')
        .withIndex('by_chain_id_and_sealed_at', (q) => q.eq('chainId', 'primary')),
    ),
    ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_recordedAt', (q) => q.eq('chainId', 'primary'))
      .order('desc')
      .take(200),
    ctx.db
      .query('exportArtifacts')
      .withIndex('by_artifact_type_and_created_at')
      .order('desc')
      .take(25),
  ]);

  const metadataGaps = recentAuditLogs
    .filter((log) => log.eventType === 'organization_policy_updated')
    .slice(0, 25)
    .map((log) => ({
      createdAt: log.recordedAt,
      eventType: log.eventType,
      id: log.id,
      resourceId: log.resourceId ?? null,
    }));

  return {
    currentHead: auditLedgerState
      ? {
          headHash: auditLedgerState.headEventHash,
          headSequence: auditLedgerState.headSequence,
          updatedAt: auditLedgerState.updatedAt,
        }
      : null,
    latestBackupDrill: latestBackupDrill
      ? {
          artifactHash: latestBackupDrill.artifactHash ?? null,
          checkedAt: latestBackupDrill.checkedAt,
          drillId: latestBackupDrill.drillId,
          drillType: latestBackupDrill.drillType,
          failureReason: latestBackupDrill.failureReason ?? null,
          initiatedByKind: latestBackupDrill.initiatedByKind,
          initiatedByUserId: latestBackupDrill.initiatedByUserId ?? null,
          restoredItemCount: latestBackupDrill.restoredItemCount,
          scopeId: normalizeSecurityScope(latestBackupDrill).scopeId,
          scopeType: normalizeSecurityScope(latestBackupDrill).scopeType,
          sourceDataset: latestBackupDrill.sourceDataset,
          status: latestBackupDrill.status,
          targetEnvironment: latestBackupDrill.targetEnvironment,
          verificationMethod: latestBackupDrill.verificationMethod,
        }
      : null,
    latestCheckpoint: latestCheckpoint
      ? {
          checkedAt: latestCheckpoint.checkedAt,
          endSequence: latestCheckpoint.endSequence,
          headHash: latestCheckpoint.headHash,
          startSequence: latestCheckpoint.startSequence,
          status: latestCheckpoint.status,
          verifiedEventCount: latestCheckpoint.verifiedEventCount,
        }
      : null,
    latestRetentionJob: latestRetentionJob
      ? {
          createdAt: latestRetentionJob.createdAt,
          details: latestRetentionJob.details ?? undefined,
          jobKind: latestRetentionJob.jobKind,
          processedCount: latestRetentionJob.processedCount,
          scopeId: normalizeSecurityScope(latestRetentionJob).scopeId,
          scopeType: normalizeSecurityScope(latestRetentionJob).scopeType,
          status: latestRetentionJob.status,
        }
      : null,
    latestVerifiedCheckpoint: latestSuccessfulCheckpoint
      ? {
          checkedAt: latestSuccessfulCheckpoint.checkedAt,
          endSequence: latestSuccessfulCheckpoint.endSequence,
          headHash: latestSuccessfulCheckpoint.headHash,
          startSequence: latestSuccessfulCheckpoint.startSequence,
          verifiedEventCount: latestSuccessfulCheckpoint.verifiedEventCount,
        }
      : null,
    latestImmutableExport: latestImmutableExport
      ? {
          endSequence: latestImmutableExport.endSequence,
          exportedAt: latestImmutableExport.exportedAt,
          headHash: latestImmutableExport.headHash,
          objectKey: latestImmutableExport.objectKey,
        }
      : null,
    lastIntegrityFailure: latestFailedCheckpoint?.failure
      ? {
          checkedAt: latestFailedCheckpoint.checkedAt,
          eventId: latestFailedCheckpoint.failure.eventId,
          expectedSequence: latestFailedCheckpoint.failure.expectedSequence,
        }
      : null,
    lastSealAt: latestSeal?.sealedAt ?? null,
    metadataGaps,
    recentDeniedActions: recentAuditLogs
      .filter((log) => log.eventType === 'authorization_denied')
      .slice(0, 25)
      .map((log) => ({
        createdAt: log.recordedAt,
        eventType: log.eventType,
        id: log.id,
        metadata: log.metadata ?? null,
        organizationId: log.organizationId ?? null,
      })),
    recentExports: recentExports.slice(0, 25).map((artifact) => ({
      artifactType: artifact.artifactType,
      exportedAt: artifact.exportedAt,
      manifestHash: artifact.manifestHash,
      sourceReportId: artifact.sourceReportId ?? null,
    })),
    immutableExportHealthy:
      latestSeal === null
        ? true
        : (latestImmutableExport?.endSequence ?? 0) >= latestSeal.endSequence,
    immutableExportLagCount: Math.max(
      0,
      latestSeal ? latestSeal.endSequence - (latestImmutableExport?.endSequence ?? 0) : 0,
    ),
    sealCount,
    unverifiedTailCount: Math.max(
      0,
      (auditLedgerState?.headSequence ?? 0) - (latestSuccessfulCheckpoint?.endSequence ?? 0),
    ),
  };
}
