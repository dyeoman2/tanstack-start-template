import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'cleanup stale chat streams',
  { hours: 1 },
  internal.chatBackground.cleanupStaleChatRuns,
  {},
);

crons.interval(
  'purge expired temporary artifacts',
  { hours: 6 },
  internal.retention.purgeExpiredTemporaryArtifacts,
  {},
);

crons.interval(
  'cleanup stale storage uploads',
  { hours: 1 },
  internal.storageCleanup.cleanupStaleUploadsInternal,
  {},
);

crons.interval(
  'enforce malware scan deadlines',
  { minutes: 5 },
  internal.storageCleanup.enforceMalwareDeadlinesInternal,
  {},
);

crons.interval(
  'reconcile orphaned mirrored storage objects',
  { hours: 6 },
  internal.storageCleanup.reconcileOrphanedMirrorObjectsInternal,
  {},
);

crons.interval(
  'verify audit ledger integrity',
  { hours: 1 },
  internal.audit.verifyAuditLedgerIntegrityInternal,
  {},
);

crons.interval(
  'archive sealed audit ledger segments',
  { minutes: 5 },
  internal.auditArchive.exportSealedAuditLedgerSegmentToImmutableStoreInternal,
  {},
);

crons.interval(
  'verify immutable audit archive',
  { hours: 1 },
  internal.auditArchive.verifyLatestSealedAuditLedgerSegmentInImmutableStoreInternal,
  {},
);

crons.interval(
  'notify expired support access grants',
  { hours: 1 },
  internal.organizationManagement.notifyExpiredOrganizationSupportAccessGrantsInternal,
  {},
);

export default crons;
