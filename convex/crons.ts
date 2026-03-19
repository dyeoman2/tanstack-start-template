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
  'cleanup expired regulated attachments',
  { hours: 6 },
  internal.security.cleanupExpiredAttachments,
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

export default crons;
